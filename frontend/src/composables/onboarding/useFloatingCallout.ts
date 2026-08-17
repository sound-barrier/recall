import { ref, watch, onMounted, onBeforeUnmount, nextTick, type Ref } from 'vue'

import type { CalloutPlacement } from '@/composables/onboarding/useOnboardingTour'
import { computeCalloutPosition, rectsEqual } from '@/components/onboarding/tour-callout-helpers'

/** Viewport-relative rect of the spotlighted target element. */
interface FloatingTargetRect {
  x: number
  y: number
  w: number
  h: number
}

/** Fixed geometry the positioning solver needs from the host component. */
interface FloatingCalloutDims {
  /** Fixed callout width in px (the height is measured live). */
  calloutW: number
  /** Height estimate used before the first real measurement. */
  calloutHInitial: number
  /** Minimum distance kept from the viewport edges. */
  safety: number
  /** Gap between the target and the callout. */
  gap: number
}

/** Inputs the engine tracks reactively. */
export interface FloatingCalloutOptions {
  /**
   * CSS selector of the spotlighted target. The callout reads this
   * for placement geometry; if null/empty the callout centers.
   */
  target: () => string | null | undefined
  /** Preferred placement; auto picks the side with the most room. */
  placement: () => CalloutPlacement | undefined
  /**
   * Extra values whose change re-runs positioning (e.g. the step
   * heading, covering in-place step swaps the target doesn't signal).
   */
  resyncSignals: () => unknown[]
  dims: FloatingCalloutDims
}

/** Everything the host SFC binds: position state + drag handlers. */
export interface FloatingCalloutApi {
  /** Template ref for the callout root (height measurement). */
  calloutEl: Ref<HTMLDivElement | null>
  /** Viewport-relative pixel position + resolved placement. */
  pos: Ref<{ left: number; top: number; placement: CalloutPlacement }>
  /** False until the first stable position is known (see below). */
  posReady: Ref<boolean>
  /** True while the header drag is active. */
  dragging: Ref<boolean>
  getTargetRect: () => FloatingTargetRect | null
  calloutHeight: () => number
  onDragPointerDown: (e: PointerEvent) => void
  onDragPointerMove: (e: PointerEvent) => void
  onDragPointerUp: (e: PointerEvent) => void
}

/**
 * Positioning + drag engine for an anchored floating callout panel.
 *
 * Owns the auto-placement solve (bottom → right → left → top via the
 * pure `computeCalloutPosition` solver), the settle-wait that absorbs
 * the target's CSS enter transition, the scroll/resize resyncs, and
 * the header-drag state machine. The host SFC supplies the reactive
 * inputs and renders from `pos` / `posReady` / `dragging`.
 */
export function useFloatingCallout(opts: FloatingCalloutOptions): FloatingCalloutApi {
  const { calloutW, calloutHInitial, safety, gap } = opts.dims

  // Geometry — viewport-relative pixel positions. The callout is
  // position: fixed; left/top are derived from `pos`.
  const pos = ref({ left: 0, top: 0, placement: 'bottom' as CalloutPlacement })
  const calloutEl = ref<HTMLDivElement | null>(null)

  // Drag state. Once the user grabs the header and moves the callout,
  // `userMoved` flips true and auto-placement stops updating `pos` —
  // the callout stays exactly where the user dropped it for the rest
  // of the step. The parent re-keys this component on every step
  // change, so dragging resets naturally between steps.
  const userMoved = ref(false)
  const dragging = ref(false)
  let dragOffsetX = 0
  let dragOffsetY = 0

  // Position-ready flag. `false` while the callout is positioning
  // itself for the first time on a step (and during the second-pass
  // resync that absorbs the target's CSS slide-in transition). The
  // callout's CSS keeps it invisible until this flips true — without
  // the gate, a step whose target enters with `transform: translateX`
  // (Narrow popover, detail panel) measures its pre-transition rect
  // on the first pass and lands at the wrong x for ~var(--duration-slow) before the
  // second pass corrects it. Users see that flash; gating it on
  // `posReady` keeps the callout hidden until the final position is
  // known.
  const posReady = ref(false)

  function getTargetRect(): FloatingTargetRect | null {
    const target = opts.target()
    if (!target) return null
    let el: HTMLElement | null = null
    try { el = document.querySelector(target) as HTMLElement | null } catch { /* invalid selector */ }
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }

  function calloutHeight(): number {
    return calloutEl.value?.offsetHeight ?? calloutHInitial
  }

  // Compute placement geometry via the pure solver — the composable just
  // supplies the live DOM measurements + viewport.
  function computePos(): { left: number; top: number; placement: CalloutPlacement } {
    return computeCalloutPosition(
      getTargetRect(),
      { calloutH: calloutHeight(), vw: window.innerWidth, vh: window.innerHeight },
      opts.placement() ?? 'auto',
      { calloutW, safety, gap },
    )
  }

  // Poll the target's rect across animation frames until it stops moving
  // (its enter transition has settled) or a frame cap is hit. This
  // replaces a fixed settle delay that raced the target's slide-in on
  // slower machines: the Narrow popover and the detail panel both
  // translate in over ~240ms, and a measure taken a few px before the
  // slide finished anchored `left`/`right` placement to a mid-transition
  // rect dozens of px off — and nothing re-synced afterwards, so it
  // stayed wrong.
  //
  // Two guards make this timing-independent. A STABILITY check (the rect
  // unchanged for several frames) waits out a transition however long it
  // runs. A minimum-frame FLOOR stops us settling during the brief
  // stillness BEFORE the transition starts — a freshly-mounted target
  // sits at its pre-slide rect for a frame or two while the browser
  // applies the entering class, and without the floor that early window
  // reads as "stable" and we measure the wrong rect (a popover slide
  // caught at x≈226 instead of its final x≈420). Settle only once both
  // hold: past the floor AND stable.
  // One frame's stability verdict: bump the streak when the rect is
  // measurable and unchanged, otherwise restart it.
  function stepStability(s: { prev: ReturnType<typeof getTargetRect>; stable: number }): void {
    const cur = getTargetRect()
    const measurable = cur !== null && cur.w > 0 && cur.h > 0
    if (measurable && s.prev && rectsEqual(cur, s.prev)) {
      s.stable++
    } else {
      s.stable = 0
    }
    s.prev = measurable ? cur : null
  }

  async function waitForStableTarget(): Promise<void> {
    if (!opts.target()) return
    const MAX_FRAMES = 90 // ~1.5s cap at 60fps — covers a slow mount + slide
    const MIN_FRAMES = 21 // ~350ms floor past the pre-transition stillness
    const STABLE_NEEDED = 3
    const s = { prev: getTargetRect(), stable: 0 }
    for (let i = 0; i < MAX_FRAMES; i++) {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      if (userMoved.value) return
      stepStability(s)
      if (i + 1 >= MIN_FRAMES && s.stable >= STABLE_NEEDED) return
    }
  }

  async function syncPos() {
    await nextTick()
    // Once the user has dragged the callout, freeze the position so
    // resize / scroll resyncs don't snap it back. The :key on the
    // parent destroys + remounts the callout per step, so the freeze
    // is automatically reset between steps.
    if (userMoved.value) return
    // Wait for the target's enter transition to settle BEFORE the first
    // compute. Skipping the pre-settle pass entirely means the callout
    // has no wrong-position to flash AT — it stays invisible via
    // opacity:0 until `posReady` flips, then snaps to the final position
    // (transition: left/top is only declared on `.tour-callout-ready` so
    // the snap is instant) and fades in over 200ms.
    await waitForStableTarget()
    if (userMoved.value) return
    pos.value = computePos()
    // Two rAFs between writing the final position and flipping the
    // ready class. Vue's nextTick alone commits the DOM mutation, but
    // the browser hasn't necessarily PAINTED the new inline left/top
    // yet. If we add `tour-callout-ready` (which carries the
    // `transition: left/top` declaration) before paint, the browser
    // captures pre-paint coords as the transition's start and
    // animates from there — visible as the callout sliding from
    // (0, 0) into the computed position. Two requestAnimationFrame
    // cycles guarantee a paint between mutation and class flip.
    await nextTick()
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    posReady.value = true
  }

  function onWindowScroll() {
    if (userMoved.value) return
    pos.value = computePos()
  }
  function onWindowResize() {
    if (userMoved.value) return
    pos.value = computePos()
  }

  // ── Drag handlers ─────────────────────────────────────────────
  // The header is the drag handle (mirrors the OS convention for
  // movable panels). Pointer events let one handler cover mouse +
  // pen + touch in one go. We capture the pointer so move/up land on
  // us even if the cursor leaves the header element.

  function onDragPointerDown(e: PointerEvent) {
    // Don't initiate a drag from clicks on controls inside the header
    // (none today, but defensive — the eyebrow / counter spans aren't
    // interactive).
    if (e.button !== 0) return
    dragging.value = true
    dragOffsetX = e.clientX - pos.value.left
    dragOffsetY = e.clientY - pos.value.top
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    e.preventDefault()
  }

  function onDragPointerMove(e: PointerEvent) {
    if (!dragging.value) return
    // Clamp into the viewport so the callout can't be dragged
    // off-screen. calloutW is fixed; height comes from the live
    // element.
    const h = calloutHeight()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const nextLeft = Math.max(0, Math.min(vw - calloutW, e.clientX - dragOffsetX))
    const nextTop  = Math.max(0, Math.min(vh - h, e.clientY - dragOffsetY))
    pos.value = { left: nextLeft, top: nextTop, placement: pos.value.placement }
    userMoved.value = true
  }

  function onDragPointerUp(e: PointerEvent) {
    if (!dragging.value) return
    dragging.value = false
    ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
  }

  watch(() => [opts.target(), opts.placement(), ...opts.resyncSignals()], () => { void syncPos() })

  // Listeners go on BEFORE the first solve, not after it. syncPos waits
  // out the target's enter transition (~350ms minimum), and the tour
  // re-keys this component on every step — registering afterwards meant
  // an instance destroyed inside that window still attached its scroll
  // + resize listeners, with no unmount left to remove them.
  onMounted(() => {
    window.addEventListener('scroll', onWindowScroll, { capture: true, passive: true })
    window.addEventListener('resize', onWindowResize)
    void syncPos()
  })

  onBeforeUnmount(() => {
    window.removeEventListener('scroll', onWindowScroll, true)
    window.removeEventListener('resize', onWindowResize)
  })

  return {
    calloutEl,
    pos,
    posReady,
    dragging,
    getTargetRect,
    calloutHeight,
    onDragPointerDown,
    onDragPointerMove,
    onDragPointerUp,
  }
}

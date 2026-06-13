<script setup lang="ts">
import { ref, computed, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'

import type { CalloutPlacement } from '../composables/useOnboardingTour'
import { computeCalloutPosition, rectsEqual } from './tour-callout-helpers'

// Anchored callout panel. Renders the step's tag / number / heading
// / body plus the Skip / Back / Next controls. Anchors to the
// spotlighted target — or centres in the viewport when no target
// exists (Welcome / Done).
//
// Auto-placement: when placement is 'auto' (default for unspecified
// steps), the callout tries bottom → right → left → top in order,
// picking the first side with enough room to fit. A SAFETY_MARGIN
// keeps the callout off the viewport edges.
//
// A dashed connector line draws from the callout toward the target.
// Drawn as an SVG path with `stroke-dasharray` for the brutalist /
// tactical aesthetic — matches the viewfinder corner brackets the
// spotlight component owns.

const props = defineProps<{
  // CSS selector of the spotlighted target. The callout reads this
  // for placement geometry; if null/empty the callout centres.
  target: string | null | undefined
  // Preferred placement; auto picks the side with the most room.
  placement?: CalloutPlacement
  // Step metadata for rendering. Owned by useOnboardingTour.
  eyebrow:   string
  num:       string
  heading:   string
  body:      string
  // Counter copy ("3 of 12").
  counter:   string
  // Button state.
  canBack:   boolean
  isLast:    boolean
}>()

const emit = defineEmits<{
  back:   []
  next:   []
  skip:   []
  finish: []
}>()

const CALLOUT_W = 360
// Min CALLOUT_H is dynamic — we estimate from the actual rendered
// height after mount. Until then we pick a reasonable default for
// initial placement calculations.
const CALLOUT_H_INITIAL = 200
const SAFETY = 16
const GAP    = 22  // gap between target and callout

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
// on the first pass and lands at the wrong x for ~320ms before the
// second pass corrects it. Users see that flash; gating it on
// `posReady` keeps the callout hidden until the final position is
// known.
const posReady = ref(false)

function getTargetRect(): { x: number; y: number; w: number; h: number } | null {
  if (!props.target) return null
  let el: HTMLElement | null = null
  try { el = document.querySelector(props.target) as HTMLElement | null } catch { /* invalid selector */ }
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, w: r.width, h: r.height }
}


function calloutHeight(): number {
  return calloutEl.value?.offsetHeight ?? CALLOUT_H_INITIAL
}

// Compute placement geometry via the pure solver — the SFC just supplies
// the live DOM measurements + viewport.
function computePos(): { left: number; top: number; placement: CalloutPlacement } {
  return computeCalloutPosition(
    getTargetRect(),
    calloutHeight(),
    window.innerWidth,
    window.innerHeight,
    props.placement ?? 'auto',
    { calloutW: CALLOUT_W, safety: SAFETY, gap: GAP },
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
async function waitForStableTarget(): Promise<void> {
  if (!props.target) return
  const MAX_FRAMES = 90 // ~1.5s cap at 60fps — covers a slow mount + slide
  const MIN_FRAMES = 21 // ~350ms floor past the pre-transition stillness
  const STABLE_NEEDED = 3
  let prev = getTargetRect()
  let stable = 0
  for (let i = 0; i < MAX_FRAMES; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    if (userMoved.value) return
    const cur = getTargetRect()
    const measurable = cur !== null && cur.w > 0 && cur.h > 0
    if (measurable && prev && rectsEqual(cur, prev)) {
      stable++
    } else {
      stable = 0
    }
    prev = measurable ? cur : null
    if (i + 1 >= MIN_FRAMES && stable >= STABLE_NEEDED) return
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
  // off-screen. CALLOUT_W is fixed; height comes from the live
  // element.
  const h = calloutHeight()
  const vw = window.innerWidth
  const vh = window.innerHeight
  const nextLeft = Math.max(0, Math.min(vw - CALLOUT_W, e.clientX - dragOffsetX))
  const nextTop  = Math.max(0, Math.min(vh - h, e.clientY - dragOffsetY))
  pos.value = { left: nextLeft, top: nextTop, placement: pos.value.placement }
  userMoved.value = true
}

function onDragPointerUp(e: PointerEvent) {
  if (!dragging.value) return
  dragging.value = false
  ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
}

watch(() => [props.target, props.placement, props.heading], () => { void syncPos() })

onMounted(async () => {
  await syncPos()
  window.addEventListener('scroll', onWindowScroll, { capture: true, passive: true })
  window.addEventListener('resize', onWindowResize)
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onWindowScroll, true)
  window.removeEventListener('resize', onWindowResize)
})

// Connector geometry — draws a dashed line from the callout's anchor
// edge toward the target's centre. Only rendered when a target is
// present (centred Welcome / Done callouts have no connector).
const connector = computed(() => {
  const t = getTargetRect()
  if (!t) return null
  const targetCx = t.x + t.w / 2
  const targetCy = t.y + t.h / 2
  // Anchor on the side of the callout closest to the target.
  const h = calloutHeight()
  const cx = pos.value.left + CALLOUT_W / 2
  const cy = pos.value.top + h / 2
  const dx = targetCx - cx
  const dy = targetCy - cy
  // Pick edge: dominant axis. Horizontal-dominant → anchor on the
  // left/right edge at the callout's vertical centre; vertical-
  // dominant → anchor on the top/bottom edge at the horizontal
  // centre. Single ternary per coord so CodeQL doesn't flag a dead
  // initial assignment (the previous let-then-overwrite shape had
  // both branches always rewriting the seed).
  const horizontalDominant = Math.abs(dx) > Math.abs(dy)
  const anchorX = horizontalDominant
    ? (dx > 0 ? pos.value.left + CALLOUT_W : pos.value.left)
    : pos.value.left + CALLOUT_W / 2
  const anchorY = horizontalDominant
    ? pos.value.top + h / 2
    : (dy > 0 ? pos.value.top + h : pos.value.top)
  return { x1: anchorX, y1: anchorY, x2: targetCx, y2: targetCy }
})
</script>

<template>
  <div
    ref="calloutEl"
    class="tour-callout"
    :class="{ 'tour-callout-ready': posReady }"
    :data-placement="pos.placement"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${CALLOUT_W}px` }"
    role="dialog"
    aria-modal="false"
    aria-labelledby="tour-callout-heading"
  >
    <header
      class="tour-callout-head"
      :class="{ 'tour-callout-head-dragging': dragging }"
      title="Drag to move"
      @pointerdown="onDragPointerDown"
      @pointermove="onDragPointerMove"
      @pointerup="onDragPointerUp"
      @pointercancel="onDragPointerUp"
    >
      <span class="tour-callout-drag-handle" aria-hidden="true">⋮⋮</span>
      <span class="tour-callout-eyebrow">{{ eyebrow }}</span>
      <span class="tour-callout-counter">{{ counter }}</span>
    </header>
    <div class="tour-callout-body-block">
      <div class="tour-callout-num" aria-hidden="true">
        {{ num }}
      </div>
      <h2 id="tour-callout-heading" class="tour-callout-heading">
        {{ heading }}
      </h2>
    </div>
    <p class="tour-callout-body">
      {{ body }}
    </p>
    <footer class="tour-callout-actions">
      <button
        type="button"
        class="tour-callout-skip"
        @click="emit('skip')"
      >
        Skip tour
      </button>
      <div class="tour-callout-actions-primary">
        <button
          type="button"
          class="btn ghost"
          :disabled="!canBack"
          @click="emit('back')"
        >
          Previous
        </button>
        <button
          type="button"
          class="btn primary tour-callout-next"
          @click="isLast ? emit('finish') : emit('next')"
        >
          {{ isLast ? 'Done' : 'Next' }}
          <span class="tour-callout-next-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  </div>

  <!-- Connector line from the callout toward the target's centre.
       Drawn as a full-viewport SVG so the absolute coords match the
       callout's own viewport positioning. -->
  <svg
    v-if="connector"
    class="tour-callout-connector"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <line
      :x1="connector.x1"
      :y1="connector.y1"
      :x2="connector.x2"
      :y2="connector.y2"
      stroke="var(--accent, #d96a2e)"
      stroke-width="1"
      stroke-dasharray="4 5"
      stroke-linecap="round"
      opacity="0.5"
    />
    <circle
      :cx="connector.x1"
      :cy="connector.y1"
      r="3"
      fill="var(--accent, #d96a2e)"
    />
  </svg>
</template>

<style scoped>
.tour-callout {
  position: fixed;
  z-index: 2002;
  pointer-events: auto;
  background: var(--surface, #1d1d1d);
  border: 1px solid var(--border, #3a3a3a);
  border-left: 3px solid var(--accent, #d96a2e);
  padding: 1.05rem 1.15rem 0.85rem;
  box-shadow:
    0 26px 70px rgb(0 0 0 / 60%),
    0 0 0 1px color-mix(in srgb, var(--accent, #d96a2e) 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  /* Stay invisible until syncPos's settle wait completes (the
     `tour-callout-ready` modifier flips on). The transition: left/
     top declaration lives ONLY on `.tour-callout-ready` so that
     the FIRST application of the computed position is an instant
     snap, not a 280ms glide from (0, 0). On subsequent updates
     (window resize, target rect change), the class is already
     present and the transitions animate normally. */
  opacity: 0;
}

.tour-callout-ready {
  opacity: 1;
  animation: tour-callout-in 320ms cubic-bezier(0.18, 1, 0.32, 1) both;
  transition: opacity 200ms ease 60ms, left 280ms ease, top 280ms ease;
}

@keyframes tour-callout-in {
  from { transform: translateY(6px) scale(0.985); }
  to   { transform: translateY(0)   scale(1); }
}

.tour-callout-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.5rem;

  /* The header doubles as the drag handle. cursor: grab telegraphs
     it without needing a label; cursor: grabbing flips while the
     pointer is captured. user-select: none so a quick drag doesn't
     accidentally start a text selection on the eyebrow/counter. */
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.tour-callout-head-dragging { cursor: grabbing; }

.tour-callout-drag-handle {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: -0.1em;
  color: var(--text-faint, #6a6a6a);
  margin-right: 0.15rem;
  opacity: 0.7;
}

.tour-callout-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent, #d96a2e);
}

.tour-callout-counter {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  color: var(--text-faint, #6a6a6a);
  font-feature-settings: "tnum";
}

.tour-callout-body-block {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: end;
  column-gap: 0.75rem;
  margin-top: 0.05rem;
}

.tour-callout-num {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-size: 3.2rem;
  line-height: 0.82;
  color: var(--accent, #d96a2e);

  /* Tilt that mirrors the masthead wordmark. Subtle — keeps
     proportions readable. */
  transform: translateY(0.06em);
}

.tour-callout-heading {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  font-size: 1.35rem;
  line-height: 1.05;
  color: var(--text, #f0f0f0);
  margin: 0;
  border-bottom: 2px solid var(--accent, #d96a2e);
  padding-bottom: 0.35rem;
  align-self: end;
}

.tour-callout-body {
  margin: 0;
  color: var(--text-dim, #c0c0c0);
  font-size: 0.86rem;
  line-height: 1.55;
}

.tour-callout-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.55rem;
  padding-top: 0.7rem;
  border-top: 1px dashed color-mix(in srgb, var(--text-faint, #6a6a6a) 38%, transparent);
}

.tour-callout-actions-primary {
  display: inline-flex;
  gap: 0.4rem;
}

.tour-callout-skip {
  background: transparent;
  border: 0;
  padding: 0.35rem 0.1rem;
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint, #6a6a6a);
  cursor: pointer;
}

.tour-callout-skip:hover { color: var(--text-dim, #c0c0c0); }

.tour-callout-skip:focus-visible {
  outline: 2px solid var(--accent, #d96a2e);
  outline-offset: 3px;
}

.tour-callout-next-arrow { margin-left: 0.35em; }

.tour-callout-connector {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 2001;
}

/* Centred (no-target) callout — slightly wider, no connector visible,
   skip the slide-from-side animation in favour of a pure fade-up. */
.tour-callout[data-placement='auto'] {
  width: min(440px, calc(100vw - 2 * 16px)) !important;
}

@media (prefers-reduced-motion: reduce) {
  .tour-callout {
    animation: none;
    transition: none;
  }
}
</style>

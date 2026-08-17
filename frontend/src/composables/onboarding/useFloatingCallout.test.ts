import { defineComponent, h, ref } from 'vue'
import { render } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFloatingCallout, type FloatingCalloutApi } from '@/composables/onboarding/useFloatingCallout'
import type { CalloutPlacement } from '@/composables/onboarding/useOnboardingTour'

// The geometry TourCallout.vue actually ships, so every expected
// coordinate below is the one a user would see.
const DIMS = { calloutW: 360, calloutHInitial: 200, safety: 16, gap: 22 }
const VW = 1280
const VH = 800

interface Box { x: number; y: number; w: number; h: number }

const spotlights: HTMLElement[] = []

// happy-dom reports an all-zero getBoundingClientRect, so the target's
// geometry is stubbed per element. A setup-time write, never asserted on.
function spotlight(initial: Box) {
  const el = document.createElement('div')
  el.id = 'spot'
  let box = initial
  el.getBoundingClientRect = () => ({
    x: box.x, y: box.y, left: box.x, top: box.y,
    width: box.w, height: box.h,
    right: box.x + box.w, bottom: box.y + box.h,
    toJSON: () => ({}),
  }) as DOMRect
  document.body.appendChild(el)
  spotlights.push(el)
  return { move: (next: Box) => { box = next } }
}

// The composable polls requestAnimationFrame until the target's rect
// stops moving. Queue the frames so a test can advance them one at a
// time and watch the settle decision happen.
let frames: FrameRequestCallback[] = []

async function pump(count: number) {
  for (let i = 0; i < count; i++) {
    frames.shift()?.(0)
    // A macrotask drains the awaited frame promise + the nextTicks
    // between phases, so the next frame is queued before we advance.
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

// Past the 21-frame floor plus the two paint frames before posReady.
const SETTLE_FRAMES = 30

// `signal` stands in for the host's resync inputs (the step heading), so
// a test can drive an in-place step swap. `measuredHeight`, when given,
// binds a callout element the way the SFC's template ref does — without
// it the composable falls back to its pre-measurement estimate.
function mountCallout(target: string | null, placement?: CalloutPlacement, measuredHeight?: number) {
  let api!: FloatingCalloutApi
  const signal = ref(0)
  const Host = defineComponent({
    setup() {
      api = useFloatingCallout({
        target: () => target,
        placement: () => placement,
        resyncSignals: () => [signal.value],
        dims: DIMS,
      })
      return () => h('div')
    },
  })
  const view = render(Host)
  if (measuredHeight !== undefined) {
    const el = document.createElement('div')
    Object.defineProperty(el, 'offsetHeight', { value: measuredHeight, configurable: true })
    api.calloutEl.value = el as HTMLDivElement
  }
  return { view, api, signal }
}

function pointerAt(clientX: number, clientY: number, button = 0): PointerEvent {
  return {
    button, clientX, clientY, pointerId: 1,
    currentTarget: {
      setPointerCapture: () => undefined,
      releasePointerCapture: () => undefined,
    },
    preventDefault: () => undefined,
  } as unknown as PointerEvent
}

beforeEach(() => {
  frames = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb))
  vi.stubGlobal('innerWidth', VW)
  vi.stubGlobal('innerHeight', VH)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const el of spotlights.splice(0)) el.remove()
})

describe('useFloatingCallout — anchoring', () => {
  it('stays hidden until the settle wait finishes, then anchors under the target', async () => {
    spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')

    // The CSS keeps the callout invisible until posReady flips — that
    // gate is what stops a mid-transition position flashing on screen.
    expect(api.posReady.value).toBe(false)

    await pump(SETTLE_FRAMES)

    expect(api.posReady.value).toBe(true)
    expect(api.pos.value).toEqual({ left: 360, top: 162, placement: 'bottom' })
  })

  it('does not settle while the target is still sliding in, and anchors to its final rect', async () => {
    // The regression this guards: a target that translates in over
    // ~240ms was measured mid-slide and the callout landed dozens of px
    // off, with nothing re-syncing afterwards.
    const spot = spotlight({ x: 200, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')

    for (let frame = 1; frame <= 25; frame++) {
      spot.move({ x: 200 + frame * 20, y: 100, w: 80, h: 40 })
      await pump(1)
    }
    // Past the minimum-frame floor, but the rect never held still —
    // settling here would anchor to a mid-slide position.
    expect(api.posReady.value).toBe(false)

    await pump(10)

    expect(api.posReady.value).toBe(true)
    expect(api.pos.value).toEqual({ left: 560, top: 162, placement: 'bottom' })
  })

  it('flips off the bottom edge once the callout measures taller than the estimate', async () => {
    // The pre-measurement estimate is 200px; a callout that renders at
    // 400 no longer clears the viewport below this target and has to
    // take the side instead of hanging off the bottom.
    spotlight({ x: 500, y: 500, w: 80, h: 40 })
    const { api } = mountCallout('#spot', undefined, 400)

    await pump(SETTLE_FRAMES)

    expect(api.calloutHeight()).toBe(400)
    expect(api.pos.value).toEqual({ left: 602, top: 320, placement: 'right' })
  })

  it('centers a step that spotlights nothing', async () => {
    const { api } = mountCallout(null)

    await pump(SETTLE_FRAMES)

    expect(api.pos.value).toEqual({ left: (VW - 360) / 2, top: (VH - 200) / 2, placement: 'auto' })
  })

  it('treats a malformed selector as no target instead of throwing', async () => {
    // Step authors write these selectors by hand; a typo must degrade
    // to the centered callout, not break the tour. The rect never
    // becomes measurable, so the settle loop rides its 90-frame cap out
    // before positioning.
    const { api } = mountCallout(':::not a selector')

    expect(api.getTargetRect()).toBeNull()
    await pump(SETTLE_FRAMES)
    expect(api.posReady.value).toBe(false)

    await pump(70)

    expect(api.pos.value).toEqual({ left: (VW - 360) / 2, top: (VH - 200) / 2, placement: 'auto' })
  })
})

describe('useFloatingCallout — resync', () => {
  it('follows the target when the page scrolls', async () => {
    const spot = spotlight({ x: 500, y: 400, w: 80, h: 40 })
    const { api } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)
    expect(api.pos.value.top).toBe(462)

    spot.move({ x: 500, y: 150, w: 80, h: 40 })
    window.dispatchEvent(new Event('scroll'))

    expect(api.pos.value.top).toBe(212)
  })

  it('re-anchors when the step swaps in place', async () => {
    // Some steps change heading + target without unmounting the callout;
    // the resync signals are the only notice it gets.
    const spot = spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api, signal } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)
    expect(api.pos.value.top).toBe(162)

    spot.move({ x: 500, y: 300, w: 80, h: 40 })
    signal.value++
    await pump(SETTLE_FRAMES)

    expect(api.pos.value.top).toBe(362)
  })

  it('re-clamps into a viewport that shrank under it', async () => {
    spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)
    expect(api.pos.value.left).toBe(360)

    vi.stubGlobal('innerWidth', 500)
    window.dispatchEvent(new Event('resize'))

    // 500 − 360 wide − 16 safety: the right-most left the callout can
    // take without hanging off the edge.
    expect(api.pos.value.left).toBe(124)
  })
})

describe('useFloatingCallout — header drag', () => {
  it('freezes auto-placement once the user has moved the callout', async () => {
    const spot = spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api, signal } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)

    api.onDragPointerDown(pointerAt(400, 200))
    expect(api.dragging.value).toBe(true)
    api.onDragPointerMove(pointerAt(430, 260))
    api.onDragPointerUp(pointerAt(430, 260))
    expect(api.dragging.value).toBe(false)
    expect(api.pos.value.left).toBe(390)
    expect(api.pos.value.top).toBe(222)

    // No resync — scroll, resize, or a step swap — may snap the callout
    // back out from under the user.
    spot.move({ x: 100, y: 600, w: 80, h: 40 })
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('scroll'))
    signal.value++
    await pump(SETTLE_FRAMES)

    expect(api.pos.value.left).toBe(390)
    expect(api.pos.value.top).toBe(222)
  })

  it('lets a drag win over a resync that is still settling', async () => {
    const spot = spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api, signal } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)

    spot.move({ x: 100, y: 600, w: 80, h: 40 })
    signal.value++
    await pump(5)

    // The resync is mid-poll when the user grabs the header — it must
    // abandon its solve rather than land on top of the drop.
    api.onDragPointerDown(pointerAt(400, 200))
    api.onDragPointerMove(pointerAt(440, 240))
    api.onDragPointerUp(pointerAt(440, 240))
    const dropped = { ...api.pos.value }
    await pump(SETTLE_FRAMES)

    expect(api.pos.value).toEqual(dropped)
  })

  it('clamps a drag so the callout cannot be pushed off screen', async () => {
    spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)

    api.onDragPointerDown(pointerAt(0, 0))
    api.onDragPointerMove(pointerAt(9000, 9000))
    expect(api.pos.value).toMatchObject({ left: VW - 360, top: VH - 200 })

    api.onDragPointerMove(pointerAt(-9000, -9000))
    expect(api.pos.value).toMatchObject({ left: 0, top: 0 })
  })

  it('ignores a right-click on the header', async () => {
    spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)

    api.onDragPointerDown(pointerAt(400, 200, 2))
    api.onDragPointerMove(pointerAt(700, 500))

    expect(api.dragging.value).toBe(false)
    expect(api.pos.value.left).toBe(360)
  })

  it('stops following the pointer after release', async () => {
    spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { api } = mountCallout('#spot')
    await pump(SETTLE_FRAMES)

    api.onDragPointerDown(pointerAt(400, 200))
    api.onDragPointerMove(pointerAt(500, 300))
    api.onDragPointerUp(pointerAt(500, 300))
    const dropped = { ...api.pos.value }
    // The header wires pointerup AND pointercancel to this handler, so a
    // cancel arriving after the release must not double-release capture.
    api.onDragPointerUp(pointerAt(500, 300))
    api.onDragPointerMove(pointerAt(900, 700))

    expect(api.pos.value).toEqual(dropped)
  })
})

describe('useFloatingCallout — teardown', () => {
  it('detaches its window listeners when the step unmounts mid-settle', async () => {
    // The tour re-keys this component per step, so a Next click inside
    // the ~350ms settle window destroys the instance while syncPos is
    // still running. Its scroll/resize listeners must not outlive it.
    const spot = spotlight({ x: 500, y: 100, w: 80, h: 40 })
    const { view, api } = mountCallout('#spot')

    view.unmount()
    await pump(SETTLE_FRAMES)
    const abandoned = { ...api.pos.value }

    spot.move({ x: 100, y: 600, w: 80, h: 40 })
    window.dispatchEvent(new Event('resize'))
    window.dispatchEvent(new Event('scroll'))

    expect(api.pos.value).toEqual(abandoned)
  })
})

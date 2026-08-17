import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render } from '@testing-library/vue'
import { nextTick } from 'vue'

import TourSpotlight from '@/components/onboarding/TourSpotlight.vue'

// The spotlight's SVG is aria-hidden decoration by design — a screen
// reader hears the callout, not the mask — so there is no accessible
// surface to query and every assertion here goes through an annotated
// node-access escape hatch. The MATH is pinned in
// tour-spotlight-helpers.test.ts; what this file covers is the wiring
// happy-dom can actually run: which target the SVG resolves, that the
// ResizeObserver re-measures, and that nothing survives unmount.

class FakeResizeObserver {
  static instances: FakeResizeObserver[] = []
  observed: Element[] = []
  disconnected = false
  constructor(public callback: () => void) {
    FakeResizeObserver.instances.push(this)
  }
  observe(el: Element) { this.observed.push(el) }
  unobserve() { /* unused by the component */ }
  disconnect() { this.disconnected = true }
}

let realResizeObserver: typeof ResizeObserver

// The component waits a frame for layout, scrolls the target into view,
// then waits out the smooth scroll before attaching its observer.
const SETTLE_MS = 400
const settle = () => new Promise(resolve => setTimeout(resolve, SETTLE_MS))

function anchorAt(bounds: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div')
  el.id = 'spot-anchor'
  // Setup-time geometry stub: happy-dom lays everything out at zero, and
  // the whole point of the component is reacting to a real rect.
  el.getBoundingClientRect = () => ({
    ...bounds,
    right: bounds.left + bounds.width,
    bottom: bounds.top + bounds.height,
    x: bounds.left,
    y: bounds.top,
    toJSON: () => ({}),
  } as DOMRect)
  document.body.appendChild(el)
  return el
}

/* eslint-disable testing-library/no-node-access -- the spotlight SVG is aria-hidden decoration; its rects/paths have no accessible handle */
const cutout = (container: Element) => container.querySelector('.tour-spotlight-cutout')
const brackets = (container: Element) => container.querySelectorAll('.tour-spotlight-brackets path')
/* eslint-enable testing-library/no-node-access */

const cutoutBox = (container: Element) => {
  const el = cutout(container)
  return el && {
    x: el.getAttribute('x'),
    y: el.getAttribute('y'),
    w: el.getAttribute('width'),
    h: el.getAttribute('height'),
  }
}

beforeEach(() => {
  FakeResizeObserver.instances = []
  realResizeObserver = globalThis.ResizeObserver
  globalThis.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver
})

afterEach(() => {
  globalThis.ResizeObserver = realResizeObserver
  // eslint-disable-next-line testing-library/no-node-access -- fixture teardown, not a query
  document.getElementById('spot-anchor')?.remove()
})

describe('TourSpotlight — cutout resolution', () => {
  it('punches a padded hole around the resolved target', async () => {
    anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { container } = render(TourSpotlight, { props: { target: '#spot-anchor', padding: 8 } })
    await settle()

    expect(cutoutBox(container)).toEqual({ x: '92', y: '192', w: '316', h: '56' })
    expect(brackets(container)).toHaveLength(4)
  })

  it('collapses the cutout for a target-less briefing step (Welcome / Done)', async () => {
    const { container } = render(TourSpotlight, { props: { target: null } })
    await settle()

    // No hole means the dim covers the entire viewport — and the
    // viewfinder brackets must not float over nothing.
    expect(cutout(container)).toBeNull()
    expect(brackets(container)).toHaveLength(0)
  })

  it('collapses rather than throwing when the selector is invalid', async () => {
    // Step data is authored by hand; a malformed selector must degrade to
    // the centered-briefing look, not blow up the whole overlay.
    const { container } = render(TourSpotlight, { props: { target: '###' } })
    await settle()
    expect(cutout(container)).toBeNull()
  })

  it('collapses when the selector resolves to nothing on this view', async () => {
    const { container } = render(TourSpotlight, { props: { target: '#not-on-screen' } })
    await settle()
    expect(cutout(container)).toBeNull()
  })

  it('re-resolves and re-measures when the step changes its target', async () => {
    anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { container, rerender } = render(TourSpotlight, {
      props: { target: '#spot-anchor', padding: 8 },
    })
    await settle()
    expect(cutoutBox(container)).not.toBeNull()

    await rerender({ target: null, padding: 8 })
    await settle()
    expect(cutout(container)).toBeNull()
  })
})

describe('TourSpotlight — live tracking', () => {
  it('re-measures the hole when the target resizes under it', async () => {
    const el = anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { container } = render(TourSpotlight, { props: { target: '#spot-anchor', padding: 8 } })
    await settle()
    expect(cutoutBox(container)).toEqual({ x: '92', y: '192', w: '316', h: '56' })

    // The Settings panel grows (a folder row expands) — the spotlight must
    // follow, or the ring ends up around half the block.
    el.getBoundingClientRect = () => ({
      left: 100, top: 200, width: 300, height: 140,
      right: 400, bottom: 340, x: 100, y: 200, toJSON: () => ({}),
    } as DOMRect)
    FakeResizeObserver.instances[0]!.callback()
    await nextTick()

    expect(cutoutBox(container)).toEqual({ x: '92', y: '192', w: '316', h: '156' })
  })

  it('re-measures on a window resize', async () => {
    const el = anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { container } = render(TourSpotlight, { props: { target: '#spot-anchor', padding: 8 } })
    await settle()

    el.getBoundingClientRect = () => ({
      left: 40, top: 200, width: 300, height: 40,
      right: 340, bottom: 240, x: 40, y: 200, toJSON: () => ({}),
    } as DOMRect)
    window.dispatchEvent(new Event('resize'))
    await nextTick()

    expect(cutoutBox(container)?.x).toBe('32')
  })
})

describe('TourSpotlight — teardown', () => {
  it('disconnects its ResizeObserver on unmount', async () => {
    anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { unmount } = render(TourSpotlight, { props: { target: '#spot-anchor' } })
    await settle()
    expect(FakeResizeObserver.instances[0]?.observed).toHaveLength(1)

    unmount()
    expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true)
  })

  it('attaches nothing when the tour closes DURING the target settle wait', async () => {
    // Escape mid-step-change: the async syncTarget is parked on its
    // smooth-scroll timer when the overlay is destroyed. Without a
    // disposal guard it wakes up afterwards and attaches an observer to
    // a detached component that nothing will ever disconnect.
    anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { unmount } = render(TourSpotlight, { props: { target: '#spot-anchor' } })
    unmount()
    await settle()

    expect(FakeResizeObserver.instances.filter(o => !o.disconnected)).toHaveLength(0)
  })

  it('stops responding to window scroll once unmounted', async () => {
    anchorAt({ left: 100, top: 200, width: 300, height: 40 })
    const { container, unmount } = render(TourSpotlight, { props: { target: '#spot-anchor', padding: 8 } })
    await settle()
    unmount()

    // A scroll after teardown must not resurrect any geometry work —
    // the SVG is gone, so a surviving listener would write to a dead ref.
    window.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(cutout(container)).toBeNull()
  })
})

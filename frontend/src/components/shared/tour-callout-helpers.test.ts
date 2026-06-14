import { describe, it, expect } from 'vitest'

import { computeCalloutPosition, rectsEqual, rectsOverlap } from '@/components/shared/tour-callout-helpers'

const LAYOUT = { calloutW: 360, safety: 16, gap: 22 }

describe('rectsOverlap', () => {
  it('returns true when one rect is fully inside the other', () => {
    expect(rectsOverlap(
      { x: 0,  y: 0,  w: 100, h: 100 },
      { x: 10, y: 10, w: 20,  h: 20  },
    )).toBe(true)
  })

  it('returns true on partial corner overlap', () => {
    expect(rectsOverlap(
      { x: 0,  y: 0,  w: 50, h: 50 },
      { x: 40, y: 40, w: 50, h: 50 },
    )).toBe(true)
  })

  it('returns false when rects touch edges but do not overlap', () => {
    // a.right === b.left → counts as non-overlap (TourCallout treats
    // adjacent placements as "clear" so a callout flush to the
    // target edge is acceptable).
    expect(rectsOverlap(
      { x: 0,  y: 0, w: 100, h: 100 },
      { x: 100, y: 0, w: 50, h: 100 },
    )).toBe(false)
  })

  it('returns false when rects are far apart on the x-axis', () => {
    expect(rectsOverlap(
      { x: 0,   y: 0, w: 50, h: 50 },
      { x: 200, y: 0, w: 50, h: 50 },
    )).toBe(false)
  })

  it('returns false when rects are far apart on the y-axis', () => {
    expect(rectsOverlap(
      { x: 0, y: 0,   w: 50, h: 50 },
      { x: 0, y: 200, w: 50, h: 50 },
    )).toBe(false)
  })

  it('does not lock up on degenerate (zero-area) rects', () => {
    // A zero-area rect at a point inside the other still counts as
    // overlapping under the half-open <= convention — fine, since
    // the spotlight never queries with a zero-area target rect in
    // practice. The pin is here so a future tweak doesn't regress
    // into a NaN-or-throw shape.
    const result = rectsOverlap(
      { x: 10, y: 10, w: 0, h: 0 },
      { x: 0,  y: 0,  w: 100, h: 100 },
    )
    expect(typeof result).toBe('boolean')
  })
})

describe('rectsEqual', () => {
  it('is true for identical rects', () => {
    expect(rectsEqual(
      { x: 100, y: 50, w: 360, h: 200 },
      { x: 100, y: 50, w: 360, h: 200 },
    )).toBe(true)
  })

  it('absorbs sub-epsilon jitter on every axis (default 0.5px)', () => {
    // Steady-state getBoundingClientRect can wobble a fraction of a
    // pixel between frames; that must still read as "settled".
    expect(rectsEqual(
      { x: 740,    y: 120,    w: 520,    h: 600    },
      { x: 740.3,  y: 119.7,  w: 520.4,  h: 600.2  },
    )).toBe(true)
  })

  it('is false while the target is mid-slide (x still moving)', () => {
    // The bug this guards: a 40px-still-moving target must NOT read as
    // stable, so placement waits for the slide to finish.
    expect(rectsEqual(
      { x: 740,   y: 120, w: 520, h: 600 },
      { x: 779.7, y: 120, w: 520, h: 600 },
    )).toBe(false)
  })

  it('honours a custom epsilon', () => {
    expect(rectsEqual(
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 3, y: 0, w: 0, h: 0 },
      4,
    )).toBe(true)
    expect(rectsEqual(
      { x: 0, y: 0, w: 0, h: 0 },
      { x: 5, y: 0, w: 0, h: 0 },
      4,
    )).toBe(false)
  })
})

describe('computeCalloutPosition', () => {
  it('centres in the viewport when there is no target', () => {
    const out = computeCalloutPosition(null, 200, 1280, 800, 'auto', LAYOUT)
    expect(out.placement).toBe('auto')
    expect(out.left).toBe((1280 - 360) / 2)
    expect(out.top).toBe((800 - 200) / 2)
  })

  it('honours an explicit placement that physically fits', () => {
    // Target mid-screen with room above → explicit "top" wins without
    // the overlap check.
    const out = computeCalloutPosition(
      { x: 600, y: 400, w: 80, h: 40 }, 200, 1280, 800, 'top', LAYOUT,
    )
    expect(out.placement).toBe('top')
    expect(out.top).toBe(400 - 22 - 200)
  })

  it('auto-search picks bottom first when there is room below', () => {
    const out = computeCalloutPosition(
      { x: 600, y: 100, w: 80, h: 40 }, 200, 1280, 800, 'auto', LAYOUT,
    )
    expect(out.placement).toBe('bottom')
    expect(out.top).toBe(100 + 40 + 22)
  })

  it('falls back to the far corner when no side has room', () => {
    // A target filling the viewport leaves no side clear → corner
    // fallback, placement reported as auto.
    const out = computeCalloutPosition(
      { x: 0, y: 0, w: 1280, h: 800 }, 200, 1280, 800, 'auto', LAYOUT,
    )
    expect(out.placement).toBe('auto')
    expect(out.left).toBeGreaterThanOrEqual(16)
    expect(out.top).toBeGreaterThanOrEqual(16)
  })
})

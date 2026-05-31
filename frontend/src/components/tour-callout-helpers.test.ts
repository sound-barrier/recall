import { describe, it, expect } from 'vitest'

import { rectsOverlap } from './tour-callout-helpers'

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

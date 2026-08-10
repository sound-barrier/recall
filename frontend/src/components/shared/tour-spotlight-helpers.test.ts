import { describe, it, expect } from 'vitest'

import {
  spotlightRectFor,
  bracketLength,
  cornerBracketPaths,
} from '@/components/shared/tour-spotlight-helpers'

// The spotlight's mask math. happy-dom zeroes every getBoundingClientRect,
// so the SFC can only be driven end-to-end in Playwright — but the
// DECISIONS (how much padding, where the hole is clamped, how long a
// bracket arm gets) are pure and belong here.

describe('spotlightRectFor', () => {
  it('grows the target by the padding on all four sides', () => {
    const out = spotlightRectFor({ left: 100, top: 200, width: 300, height: 40 }, 8)
    expect(out).toEqual({ x: 92, y: 192, w: 316, h: 56 })
  })

  it('collapses the cutout when there is no target (Welcome / Done steps)', () => {
    // A zero-size hole is what makes the dim cover the whole viewport.
    expect(spotlightRectFor(null, 18)).toEqual({ x: 0, y: 0, w: 0, h: 0 })
  })

  it('clamps a partly-offscreen target to the viewport origin', () => {
    // A target at the very top-left would push the padded hole negative;
    // the rounded corner would then be drawn off-screen and read as a
    // straight edge. x/y floor at 0 while width/height keep the padding.
    const out = spotlightRectFor({ left: 2, top: 0, width: 60, height: 30 }, 12)
    expect(out.x).toBe(0)
    expect(out.y).toBe(0)
    expect(out.w).toBe(84)
    expect(out.h).toBe(54)
  })

  it('honors a per-step padding bump (the Parse button uses 18)', () => {
    const tight = spotlightRectFor({ left: 500, top: 500, width: 120, height: 44 }, 8)
    const roomy = spotlightRectFor({ left: 500, top: 500, width: 120, height: 44 }, 18)
    expect(roomy.w - tight.w).toBe(20)
    expect(roomy.x).toBe(tight.x - 10)
  })
})

describe('bracketLength', () => {
  it('is a fraction of the shorter side for a mid-size cutout', () => {
    // 18% of the 80px-tall side = 14.4, inside the [10, 20] band.
    expect(bracketLength({ x: 0, y: 0, w: 400, h: 80 })).toBeCloseTo(14.4)
  })

  it('floors at 10px so a tiny target still reads as a viewfinder', () => {
    expect(bracketLength({ x: 0, y: 0, w: 20, h: 20 })).toBe(10)
  })

  it('caps at 20px so a full-screen cutout does not draw a border', () => {
    expect(bracketLength({ x: 0, y: 0, w: 1280, h: 800 })).toBe(20)
  })

  it('is zero for a collapsed cutout — no brackets without a hole', () => {
    expect(bracketLength({ x: 0, y: 0, w: 0, h: 0 })).toBe(0)
    expect(bracketLength({ x: 5, y: 5, w: 100, h: 0 })).toBe(0)
  })
})

describe('cornerBracketPaths', () => {
  const RECT = { x: 100, y: 50, w: 200, h: 80 }

  it('draws exactly one L per corner', () => {
    const paths = cornerBracketPaths(RECT, 12)
    expect(paths.map(p => p.corner)).toEqual([
      'top-left', 'top-right', 'bottom-right', 'bottom-left',
    ])
  })

  it('each L turns AT its corner — arm, vertex, arm', () => {
    const byCorner = Object.fromEntries(
      cornerBracketPaths(RECT, 12).map(p => [p.corner, p.d]),
    )
    // Vertices: (100,50) (300,50) (300,130) (100,130); each arm runs 12px
    // back along the two edges that meet there.
    expect(byCorner['top-left']).toBe('M 100 62 L 100 50 L 112 50')
    expect(byCorner['top-right']).toBe('M 288 50 L 300 50 L 300 62')
    expect(byCorner['bottom-right']).toBe('M 300 118 L 300 130 L 288 130')
    expect(byCorner['bottom-left']).toBe('M 112 130 L 100 130 L 100 118')
  })

  it('degenerates to four points when the arm length is zero', () => {
    // Guards the collapsed-cutout path: no NaN, no stray strokes.
    for (const { d } of cornerBracketPaths({ x: 0, y: 0, w: 0, h: 0 }, 0)) {
      expect(d).toBe('M 0 0 L 0 0 L 0 0')
    }
  })
})

import { describe, expect, it } from 'vitest'

import { SPARK_H, SPARK_W, midY, sparkAria, sparkPoints } from '@/components/compare/form-sparkline'

// Pure SVG geometry for the verdict card's facing sparkline pair. happy-dom
// gives every element a zero-sized box, so the shape can only be verified as
// numbers — which is exactly why the geometry lives outside the SFC.

function ys(points: string): number[] {
  return points.split(' ').map((p) => Number(p.split(',')[1]))
}

function xs(points: string): number[] {
  return points.split(' ').map((p) => Number(p.split(',')[0]))
}

describe('sparkPoints', () => {
  it('draws nothing for a window with no decisive games', () => {
    expect(sparkPoints([])).toBe('')
  })

  it('draws a single value as a flat line spanning the full width', () => {
    const points = sparkPoints([50])
    expect(xs(points)).toEqual([0, SPARK_W])
    // 50% sits exactly on the midline the view also draws.
    expect(ys(points)).toEqual([midY, midY])
  })

  it('maps 100% to the top of the padded box and 0% to its bottom', () => {
    const points = sparkPoints([100, 0])
    const [top, bottom] = ys(points)
    expect(top).toBeLessThan(bottom!)
    // The line stays inside the viewBox with room for the stroke.
    expect(top).toBeGreaterThan(0)
    expect(bottom).toBeLessThan(SPARK_H)
    expect(top! + bottom!).toBeCloseTo(2 * midY, 5)
  })

  it('spreads N points evenly from the left edge to the right', () => {
    const points = sparkPoints([0, 25, 50, 75, 100])
    expect(xs(points)).toEqual([0, 55, 110, 165, SPARK_W])
  })
})

describe('sparkAria', () => {
  it('states the line\'s start, end, and sample size so the chart is not pixels-only', () => {
    expect(sparkAria([40, 60, 80], 'this period'))
      .toBe('Rolling win rate this period: 40% to 80% across 3 decisive games')
  })

  it('returns no label for an empty series — the view renders a text fallback instead', () => {
    expect(sparkAria([], 'this period')).toBe('')
  })
})

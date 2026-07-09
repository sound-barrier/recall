import { describe, it, expect } from 'vitest'

import { wilsonInterval, wilsonLowerBound, wilsonMargin, LOW_SAMPLE_N } from '@/match/match-sample-helpers'

describe('wilsonLowerBound', () => {
  it('ranks a solid 75% over a thin perfect sample', () => {
    // The audit's motivating case: 3-0 must not outrank 9-3.
    expect(wilsonLowerBound(9, 12)).toBeGreaterThan(wilsonLowerBound(3, 3))
  })

  it('grows with sample size at a fixed rate', () => {
    expect(wilsonLowerBound(30, 40)).toBeGreaterThan(wilsonLowerBound(3, 4))
  })

  it('matches the known closed-form values', () => {
    expect(wilsonLowerBound(3, 3)).toBeCloseTo(0.4385, 3)
    expect(wilsonLowerBound(9, 12)).toBeCloseTo(0.4677, 3)
    expect(wilsonLowerBound(0, 10)).toBeCloseTo(0, 2)
  })

  it('returns 0 for an empty sample', () => {
    expect(wilsonLowerBound(0, 0)).toBe(0)
  })

  it('stays within [0, 1]', () => {
    expect(wilsonLowerBound(100, 100)).toBeLessThanOrEqual(1)
    expect(wilsonLowerBound(0, 1)).toBeGreaterThanOrEqual(0)
  })
})

describe('LOW_SAMPLE_N', () => {
  it('is the documented five-match line', () => {
    expect(LOW_SAMPLE_N).toBe(5)
  })
})

describe('wilsonMargin', () => {
  it('returns the rounded 95% half-width in percentage points', () => {
    // 9/14 → Wilson 95% half-width ≈ 22.4 → 22.
    expect(wilsonMargin(9, 14)).toBe(22)
    // Large solid sample tightens: 60/100 → ± ≈ 9.
    expect(wilsonMargin(60, 100)).toBe(9)
  })

  it('null with no decisive matches', () => {
    expect(wilsonMargin(0, 0)).toBeNull()
  })
})

describe('wilsonInterval', () => {
  it('returns both 95% bounds as fractions', () => {
    const iv = wilsonInterval(9, 14)
    expect(iv).not.toBeNull()
    // 9/14 ≈ 64.3%: the honest range is roughly 38.8%–83.7%.
    expect(iv!.lower).toBeCloseTo(0.3876, 3)
    expect(iv!.upper).toBeCloseTo(0.8366, 3)
  })

  it('null with no sample', () => {
    expect(wilsonInterval(0, 0)).toBeNull()
  })

  it('is the single source the sibling views delegate to (bit-identical)', () => {
    for (const [w, n] of [[9, 14], [3, 3], [60, 100], [0, 7], [1, 1]] as const) {
      const iv = wilsonInterval(w, n)!
      expect(wilsonLowerBound(w, n)).toBe(iv.lower)
      expect(wilsonMargin(w, n)).toBe(Math.round(((iv.upper - iv.lower) / 2) * 100))
    }
  })
})

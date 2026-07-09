import { describe, it, expect } from 'vitest'

import { normalCdf, binomialTwoSidedP, inverseGaussianCdf, lossStreakChance } from '@/match/elo-stats'

describe('normalCdf', () => {
  it('hits the textbook anchors', () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6)
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 4)
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 4)
    expect(normalCdf(6)).toBeCloseTo(1, 6)
    expect(normalCdf(-6)).toBeCloseTo(0, 6)
  })
})

describe('binomialTwoSidedP', () => {
  it('matches the exact enumeration for 7 wins in 10', () => {
    // P(X ≤ 3) for Binomial(10, ½) = (1+10+45+120)/1024 = 176/1024;
    // two-sided = 2·176/1024 = 0.34375 exactly.
    expect(binomialTwoSidedP(7, 10)).toBeCloseTo(0.34375, 10)
  })

  it('is 1 at a dead-even record and null with no sample', () => {
    expect(binomialTwoSidedP(50, 100)).toBe(1)
    expect(binomialTwoSidedP(0, 0)).toBeNull()
  })

  it('is symmetric in wins vs losses', () => {
    expect(binomialTwoSidedP(60, 100)).toBeCloseTo(binomialTwoSidedP(40, 100)!, 12)
    // The 60/100 case ≈ 0.0569 (not significant at 0.05 — barely).
    expect(binomialTwoSidedP(60, 100)).toBeCloseTo(0.0569, 3)
  })

  it('handles large n in the far tail without overflow', () => {
    const p = binomialTwoSidedP(1100, 2000)!
    expect(p).toBeGreaterThan(0)
    expect(p).toBeLessThan(1e-4)
  })
})

describe('inverseGaussianCdf', () => {
  it('matches the closed form for IG(1, 1) at t = 1', () => {
    // F(1) = Φ(0) + e²·Φ(−2) ≈ 0.5 + 7.38906·0.02275 ≈ 0.66810.
    expect(inverseGaussianCdf(1, 1, 1)).toBeCloseTo(0.6681, 3)
  })

  it('is 0 at t ≤ 0, exceeds ½ at the mean (median < mean), and is monotone to 1', () => {
    expect(inverseGaussianCdf(0, 5, 3)).toBe(0)
    expect(inverseGaussianCdf(-2, 5, 3)).toBe(0)
    expect(inverseGaussianCdf(5, 5, 3)).toBeGreaterThan(0.5)
    let prev = 0
    for (const t of [1, 2, 5, 10, 30, 100, 1000]) {
      const v = inverseGaussianCdf(t, 5, 3)
      expect(v).toBeGreaterThanOrEqual(prev)
      prev = v
    }
    expect(prev).toBeCloseTo(1, 4)
  })

  it('is continuous across the asymptotic-tail switch (z₂ = 8)', () => {
    // Sweep a λ range that carries z₂ through 8 at fixed t/μ and check
    // neighbouring evaluations never jump.
    let prev: number | null = null
    for (let lambda = 40; lambda <= 90; lambda += 1) {
      const v = inverseGaussianCdf(0.5, 1, lambda)
      if (prev !== null) expect(Math.abs(v - prev)).toBeLessThan(0.01)
      prev = v
    }
  })
})

describe('lossStreakChance', () => {
  it('matches hand enumeration at a fair coin', () => {
    expect(lossStreakChance(0.5, 1, 1)).toBeCloseTo(0.5, 12)
    expect(lossStreakChance(0.5, 2, 2)).toBeCloseTo(0.25, 12)
    // Of the 8 length-3 win/loss sequences, 3 contain a 2-loss run → 0.375.
    expect(lossStreakChance(0.5, 2, 3)).toBeCloseTo(0.375, 12)
  })

  it('handles the degenerate edges', () => {
    expect(lossStreakChance(0.5, 5, 4)).toBe(0) // streak longer than horizon
    expect(lossStreakChance(0, 3, 3)).toBe(1) // all losses
    expect(lossStreakChance(1, 1, 50)).toBe(0) // never loses
  })

  it('a 5-loss streak over 100 games is LIKELY at a 52% win rate (~75%)', () => {
    const p = lossStreakChance(0.52, 5, 100)
    expect(p).toBeGreaterThan(0.6)
    expect(p).toBeLessThan(0.85)
  })
})

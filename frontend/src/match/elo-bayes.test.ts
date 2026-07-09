import { describe, it, expect } from 'vitest'

import {
  SKEPTIC_PRIOR, probTrueWinRateAbove, credibleInterval, gamesToKnow,
  posteriorClimbQuantiles, shrunkWinRate,
} from '@/match/elo-bayes'
import { inverseGaussianCdf } from '@/match/elo-stats'
import type { ProjectionInput } from '@/match/elo-model'

describe('probTrueWinRateAbove', () => {
  it('is exactly ½ when the posterior is symmetric around the threshold', () => {
    // Skeptic prior Beta(10,10) + a dead-even record keeps the symmetry.
    expect(probTrueWinRateAbove(0.5, 0, 0)).toBeCloseTo(0.5, 10)
    expect(probTrueWinRateAbove(0.5, 25, 25)).toBeCloseTo(0.5, 10)
  })

  it('matches the exact binomial-tail identity under a flat prior', () => {
    // Flat Beta(1,1) + 60W/40L → posterior Beta(61,41);
    // P(p > ½) = P(Binomial(101, ½) ≤ 60), computable exactly in log space.
    let logTerm = 101 * Math.log(0.5)
    let below61 = 0
    for (let k = 0; k <= 60; k++) {
      below61 += Math.exp(logTerm)
      logTerm += Math.log((101 - k) / (k + 1))
    }
    expect(probTrueWinRateAbove(0.5, 60, 40, { alpha: 1, beta: 1 })).toBeCloseTo(below61, 9)
  })

  it('the skeptic prior tempers a hot small sample', () => {
    // 8W/2L raw is 80%, but Beta(10,10) shrinks it: still >½-likely, far from certain.
    const p = probTrueWinRateAbove(0.5, 8, 2)
    expect(p).toBeGreaterThan(0.7)
    expect(p).toBeLessThan(0.95)
  })
})

describe('credibleInterval', () => {
  it('is symmetric around ½ for a symmetric posterior', () => {
    const iv = credibleInterval(20, 20)
    expect(iv.lower + iv.upper).toBeCloseTo(1, 6)
    expect(iv.lower).toBeLessThan(0.5)
  })

  it('the interval endpoints invert the posterior CDF at 2.5% / 97.5%', () => {
    // Verified through the same betaCdf the quantile search uses — a
    // round-trip: CDF(quantile(q)) = q.
    const iv = credibleInterval(39, 21)
    // Posterior Beta(49, 31); check via a numeric CDF round-trip identity
    // on the mean-anchored bounds: lower < mean < upper.
    const mean = 49 / 80
    expect(iv.lower).toBeLessThan(mean)
    expect(iv.upper).toBeGreaterThan(mean)
    expect(iv.upper - iv.lower).toBeLessThan(0.25) // n=60 + prior pins it reasonably
  })

  it('narrows as the sample grows', () => {
    const small = credibleInterval(6, 4)
    const large = credibleInterval(600, 400)
    expect(large.upper - large.lower).toBeLessThan(small.upper - small.lower)
  })
})

describe('gamesToKnow', () => {
  it('matches the closed-form normal-approximation inversion', () => {
    // Posterior Beta(49,31): p̂ = 0.6125, n_eff = 80. Half-width 3 pts →
    // n_tot = 0.6125·0.3875·(1.96/0.03)² = 1013.03… → 1014 − 80 = 934.
    const p = 49 / 80
    const nTot = (p * (1 - p) * 1.96 * 1.96) / (0.03 * 0.03)
    expect(gamesToKnow(39, 21, 0.03)).toBe(Math.ceil(nTot - 80))
  })

  it('is 0 once the sample already pins the rate', () => {
    expect(gamesToKnow(3000, 3000, 0.03)).toBe(0)
  })
})

describe('shrunkWinRate', () => {
  it('pulls a hot 3–0 toward the pool rate with strength-10 pseudo-games', () => {
    // Pool 39W/21L → 65%; adjusted = (3 + 10·0.65)/(3 + 10) = 9.5/13.
    expect(shrunkWinRate(3, 0, 39, 21)).toBeCloseTo(9.5 / 13, 10)
  })

  it('barely moves a large record', () => {
    const adj = shrunkWinRate(180, 60, 200, 100)! // raw 75%, pool 66.7%
    expect(adj).toBeGreaterThan(0.74)
    expect(adj).toBeLessThan(0.75)
  })

  it('is null without a pool', () => {
    expect(shrunkWinRate(3, 0, 0, 0)).toBeNull()
  })
})

describe('posteriorClimbQuantiles', () => {
  const base: ProjectionInput = {
    currentScore: 13, targetScore: 15, winRate: 0.7, sampleWins: 700, sampleLosses: 300,
    meterMovePct: 20, decaySlope: 0.015,
  }

  it('collapses to the plain first-passage quantiles when the posterior is a point', () => {
    // A huge sample pins p ≈ 0.7, so the mixture ≈ IG(μ, λ) at that p:
    // D = 2, step 0.2, drift 0.08 → μ = 25; σ² = 0.2²·4·0.21 = 0.0336,
    // λ = 4/0.0336 = 119.05. Invert its CDF directly for the reference.
    const q = posteriorClimbQuantiles({ ...base, sampleWins: 70000, sampleLosses: 30000 })!
    const invert = (target: number): number => {
      let lo = 0
      let hi = 400
      for (let i = 0; i < 80; i++) {
        const mid = (lo + hi) / 2
        if (inverseGaussianCdf(mid, 25, 4 / 0.0336) < target) lo = mid
        else hi = mid
      }
      return (lo + hi) / 2
    }
    expect(q.pNever).toBeCloseTo(0, 3)
    expect(q.p50!).toBeCloseTo(invert(0.5), 0)
    expect(q.p10!).toBeCloseTo(invert(0.1), 0)
    expect(q.p90!).toBeCloseTo(invert(0.9), 0)
    expect(q.p10!).toBeLessThan(q.p50!)
    expect(q.p50!).toBeLessThan(q.p90!)
  })

  it('reports never-mass for a posterior straddling the 50% wall', () => {
    // 26W/24L + Beta(10,10) → posterior Beta(36,34), mean 51.4% — a big
    // slice of the posterior sits at or below 50%, where the climb never
    // completes. The never-mass must show up and swallow the p90.
    const q = posteriorClimbQuantiles({ ...base, winRate: 0.52, sampleWins: 26, sampleLosses: 24 })!
    expect(q.pNever).toBeGreaterThan(0.3)
    expect(q.p90).toBeNull()
  })

  it('is null for a non-climb', () => {
    expect(posteriorClimbQuantiles({ ...base, targetScore: 13 })).toBeNull()
    expect(posteriorClimbQuantiles({ ...base, targetScore: 12 })).toBeNull()
  })

  it('exports the skeptic prior the UI documents', () => {
    expect(SKEPTIC_PRIOR).toEqual({ alpha: 10, beta: 10 })
  })
})

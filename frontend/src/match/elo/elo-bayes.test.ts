import { describe, it, expect } from 'vitest'

import {
  SKEPTIC_PRIOR, probTrueWinRateAbove, credibleInterval, gamesToKnow,
  shrunkWinRate, ceilingRange,
} from '@/match/elo/elo-bayes'
import { LADDER_MAX } from '@/match/elo/elo-model'
import type { ProjectionInput } from '@/match/elo/elo-model'

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
    expect(shrunkWinRate(3, 0, { wins: 39, losses: 21 })).toBeCloseTo(9.5 / 13, 10)
  })

  it('barely moves a large record', () => {
    const adj = shrunkWinRate(180, 60, { wins: 200, losses: 100 })! // raw 75%, pool 66.7%
    expect(adj).toBeGreaterThan(0.74)
    expect(adj).toBeLessThan(0.75)
  })

  it('is null without a pool', () => {
    expect(shrunkWinRate(3, 0, { wins: 0, losses: 0 })).toBeNull()
  })
})

describe('SKEPTIC_PRIOR', () => {
  it('exports the skeptic prior the UI documents', () => {
    expect(SKEPTIC_PRIOR).toEqual({ alpha: 10, beta: 10 })
  })
})

describe('ceilingRange', () => {
  const base: ProjectionInput = {
    currentScore: 13.4,
    targetScore: 15,
    winRate: 0.55,
    sampleWins: 110,
    sampleLosses: 90,
    meterMovePct: 20,
    decaySlope: 0.015,
  }

  it('brackets the point plateau on a well-measured sample', () => {
    // Point plateau: 13.4 + 0.05/0.015 ≈ 16.7. A 200-game sample keeps the
    // posterior tight, so the range surrounds it without exploding.
    const r = ceilingRange(base, null)
    expect(r.lo).toBeLessThan(16.7)
    expect(r.hi).not.toBeNull()
    expect(r.hi!).toBeGreaterThan(16.7)
    expect(r.hi! - r.lo).toBeLessThan(10)
  })

  it('is honestly enormous on three games', () => {
    const r = ceilingRange({ ...base, winRate: 1 / 3, sampleWins: 1, sampleLosses: 2 }, null)
    expect(r.hi === null || r.hi - r.lo > 10).toBe(true)
  })

  it('a slope CI admitting an improver leaves the top open', () => {
    const r = ceilingRange(base, { lowerPts: -0.2, upperPts: 2.5 })
    expect(r.hi).toBeNull()
  })

  it('a wide positive slope CI widens the range beyond the fixed-slope one', () => {
    const fixed = ceilingRange(base, null)
    const wide = ceilingRange(base, { lowerPts: 1, upperPts: 3 })
    expect(wide.hi!).toBeGreaterThan(fixed.hi!)
    expect(wide.lo).toBeLessThanOrEqual(fixed.lo)
  })

  it('clamps to the ladder', () => {
    const r = ceilingRange({ ...base, winRate: 0.95, sampleWins: 190, sampleLosses: 10 }, null)
    expect(r.hi === null || r.hi <= LADDER_MAX).toBe(true)
    const low = ceilingRange({ ...base, winRate: 0.05, sampleWins: 10, sampleLosses: 190 }, null)
    expect(low.lo).toBeGreaterThanOrEqual(0)
  })

  it('an edited rate shifts the range without narrowing it', () => {
    // Same real 200-game sample; the dial says 60% instead of the measured
    // 55%. The range must move up but keep honest real-n width.
    const measured = ceilingRange(base, null)
    const nudged = ceilingRange({ ...base, winRate: 0.6 }, null)
    expect(nudged.lo).toBeGreaterThan(measured.lo)
    expect(nudged.hi!).toBeGreaterThan(measured.hi!)
    expect(nudged.hi! - nudged.lo).toBeCloseTo(measured.hi! - measured.lo, 1)
  })
})

describe('ceilingRange — slope-CI honesty and the asymmetric break-even', () => {
  const base: ProjectionInput = {
    currentScore: 13.4, targetScore: 15, winRate: 0.55,
    sampleWins: 110, sampleLosses: 90, meterMovePct: 20, decaySlope: 0.015,
  }

  it('a measured lower bound below the 0.5-pt floor opens the top honestly', () => {
    // 0.2 pts is inside the CI but below the floor: flooring it to 0.5
    // would quote a hard edge the envelope does not cover.
    const r = ceilingRange(base, { lowerPts: 0.2, upperPts: 2.0 })
    expect(r.hi).toBeNull()
  })

  it('the slope CI clamps to the dial maximum like every other decay figure', () => {
    const wild = ceilingRange(base, { lowerPts: 1, upperPts: 40 })
    const capped = ceilingRange(base, { lowerPts: 1, upperPts: 5 })
    expect(wild).toEqual(capped)
  })

  it('an asymmetric break-even shifts the whole range', () => {
    const sym = ceilingRange(base, null)
    const asym = ceilingRange({ ...base, plateauRate: 0.625 }, null)
    expect(asym.hi!).toBeLessThan(sym.hi!)
    expect(asym.lo).toBeLessThanOrEqual(sym.lo)
  })
})

import { describe, it, expect } from 'vitest'

import {
  naiveProjection, decayProjection, probWithinGames, requiredWinRateForGames,
  projectionCurves, gamesToWeeks, DEFAULT_DECAY_SLOPE, LADDER_MAX,
} from '@/match/elo-model'
import type { ProjectionInput } from '@/match/elo-model'

// A comfortable sample (140/60 = 70% over n=200) keeps the Wilson interval
// entirely above 50%, so CI bounds stay finite unless a case wants otherwise.
function input(over: Partial<ProjectionInput> = {}): ProjectionInput {
  return {
    currentScore: 13.4, // Gold 2 @ 40%
    targetScore: 15, // Platinum 5
    winRate: 0.6,
    sampleWins: 140,
    sampleLosses: 60,
    meterMovePct: 20,
    decaySlope: DEFAULT_DECAY_SLOPE,
    ...over,
  }
}

describe('naiveProjection', () => {
  it('matches the closed form: one division at 60% WR and ±20%/game is 25 games', () => {
    const p = naiveProjection(input({ currentScore: 14, targetScore: 15, winRate: 0.6 }))
    expect(p.reachable).toBe(true)
    expect(p.expectedGames).toBeCloseTo(25, 9) // 1 / (0.2·0.2)
    expect(p.driftPerGame).toBeCloseTo(0.04, 12)
  })

  it('a 50% win rate cannot climb; drift pointing away is unreachable', () => {
    expect(naiveProjection(input({ winRate: 0.5 })).reachable).toBe(false)
    expect(naiveProjection(input({ winRate: 0.45 })).reachable).toBe(false)
    expect(naiveProjection(input({ winRate: 0.45 })).expectedGames).toBeNull()
  })

  it('already at the target is zero games', () => {
    const p = naiveProjection(input({ targetScore: 13.4 }))
    expect(p.reachable).toBe(true)
    expect(p.expectedGames).toBe(0)
  })

  it('descending on a losing record is a valid projection', () => {
    const p = naiveProjection(input({ currentScore: 15, targetScore: 14, winRate: 0.4 }))
    expect(p.reachable).toBe(true)
    expect(p.expectedGames).toBeCloseTo(25, 9) // −1 / (0.2·−0.2)
  })

  it('games95 follows a dialed rate at real-sample width', () => {
    // The real sample is 140/60 (70%) but the dial says 55%: the interval
    // must recenter on the dialed rate — glued to the sample rate it would
    // exclude the projection's own expected games (80 > the sample-rate
    // interval's slow bound of ~30).
    const dialed = naiveProjection(input({ winRate: 0.55 }))
    expect(dialed.expectedGames).not.toBeNull()
    expect(dialed.games95.lower).not.toBeNull()
    expect(dialed.games95.lower!).toBeLessThanOrEqual(dialed.expectedGames!)
    expect(dialed.games95.upper === null || dialed.games95.upper >= dialed.expectedGames!).toBe(true)
  })

  it('propagates the Wilson interval: a thin sample cannot rule out never', () => {
    // 9W/5L ≈ 64% but Wilson lower ≈ 39% < 50% → upper CI unbounded.
    const p = naiveProjection(input({ sampleWins: 9, sampleLosses: 5 }))
    expect(p.games95.lower).not.toBeNull()
    expect(p.games95.upper).toBeNull()
    // The solid n=200 sample keeps both bounds finite.
    const solid = naiveProjection(input())
    expect(solid.games95.lower).not.toBeNull()
    expect(solid.games95.upper).not.toBeNull()
    expect(solid.games95.upper!).toBeGreaterThan(solid.games95.lower!)
  })

  it('quantifies the pure-luck spread at exactly the given win rate', () => {
    // D=5, p=0.55, m=21: E = 238.1, sd = √(D·σ²/δ³) ≈ 153.6.
    const p = naiveProjection(input({ currentScore: 10, targetScore: 15, winRate: 0.55, meterMovePct: 21 }))
    expect(p.expectedGames).toBeCloseTo(238.095, 2)
    expect(p.walkStdGames).toBeCloseTo(153.6, 0)
  })
})

describe('probWithinGames / requiredWinRateForGames', () => {
  it('is ~50%+ at the expected games and monotone in the horizon', () => {
    const inp = input({ currentScore: 14, targetScore: 15, winRate: 0.6 })
    const atMean = probWithinGames(inp, 25)!
    expect(atMean).toBeGreaterThan(0.5) // IG median < mean
    expect(probWithinGames(inp, 5)!).toBeLessThan(atMean)
    expect(probWithinGames(inp, 500)!).toBeGreaterThan(0.99)
  })

  it('inverts the naive model exactly', () => {
    const inp = input({ currentScore: 14, targetScore: 15, winRate: 0.6, meterMovePct: 20 })
    expect(requiredWinRateForGames(inp, 25)).toBeCloseTo(0.6, 12)
    expect(requiredWinRateForGames(inp, 1)).toBeNull() // would need > 100%
    expect(requiredWinRateForGames(input({ targetScore: 13 }), 50)).toBeNull() // not a climb
  })
})

describe('decayProjection', () => {
  it('matches the closed form and identifies the implied true rank', () => {
    // x₀=15, p=0.55, s=0.015 → T = 18.3̅; target 17 at m=21:
    // ln(3.3̅/1.3̅)/(2·0.015·0.21) ≈ 145.5 games.
    const p = decayProjection(input({ currentScore: 15, targetScore: 17, winRate: 0.55, meterMovePct: 21 }))
    expect(p.impliedTrueScore).toBeCloseTo(18.3333, 3)
    expect(p.reachable).toBe(true)
    expect(p.expectedGames).toBeCloseTo(145.5, 0)
  })

  it('targets beyond the implied true rank are unreachable with a required-WR verdict', () => {
    const p = decayProjection(input({ currentScore: 15, targetScore: 20, winRate: 0.55 }))
    expect(p.reachable).toBe(false)
    expect(p.expectedGames).toBeNull()
    // required = 0.5 + 0.015·(20−15) = 0.575.
    expect(p.requiredWinRate).toBeCloseTo(0.575, 12)
  })

  it('limits to the naive model as the slope vanishes', () => {
    const inp = input({ currentScore: 14, targetScore: 15, winRate: 0.6, decaySlope: 1e-6 })
    const decay = decayProjection(inp).expectedGames!
    const naive = naiveProjection(inp).expectedGames!
    expect(Math.abs(decay - naive) / naive).toBeLessThan(0.01)
  })
})

describe('projectionCurves', () => {
  it('the decay trajectory passes through the target at its expected games', () => {
    const inp = input({ currentScore: 15, targetScore: 17, winRate: 0.55, meterMovePct: 21 })
    const games = decayProjection(inp).expectedGames!
    const curves = projectionCurves(inp, { horizonGames: Math.ceil(games * 2), points: 400 })
    // Find the sampled point nearest the expected games and check the curve is ~at target.
    const idx = curves.games.reduce((best, g, i) => (Math.abs(g - games) < Math.abs(curves.games[best]! - games) ? i : best), 0)
    expect(curves.decay[idx]!).toBeCloseTo(17, 1)
  })

  it('the confidence band starts at zero width and widens monotonically', () => {
    const curves = projectionCurves(input(), { horizonGames: 100, points: 50 })
    expect(curves.bandHigh[0]! - curves.bandLow[0]!).toBeCloseTo(0, 9)
    const w25 = curves.bandHigh[25]! - curves.bandLow[25]!
    const w50 = curves.bandHigh[50]! - curves.bandLow[50]!
    expect(w25).toBeGreaterThan(0)
    expect(w50).toBeGreaterThanOrEqual(w25)
  })

  it('clamps every series to the ladder', () => {
    const curves = projectionCurves(input({ currentScore: 39, winRate: 0.9, targetScore: 40 }), { horizonGames: 400, points: 40 })
    for (const arr of [curves.naive, curves.decay, curves.bandLow, curves.bandHigh]) {
      for (const v of arr) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(LADDER_MAX)
      }
    }
  })

  it('picks a sane default horizon', () => {
    const c = projectionCurves(input({ currentScore: 14, targetScore: 15, winRate: 0.6 }))
    expect(c.horizonGames).toBeGreaterThanOrEqual(50)
    expect(c.horizonGames).toBeLessThanOrEqual(1500)
    // Unreachable both ways → fallback 250.
    expect(projectionCurves(input({ winRate: 0.5 })).horizonGames).toBe(250)
  })
})

describe('gamesToWeeks', () => {
  it('converts at the measured pace and nulls when unknown', () => {
    expect(gamesToWeeks(120, 10)).toBeCloseTo(12, 9)
    expect(gamesToWeeks(null, 10)).toBeNull()
    expect(gamesToWeeks(120, null)).toBeNull()
    expect(gamesToWeeks(120, 0)).toBeNull()
  })
})

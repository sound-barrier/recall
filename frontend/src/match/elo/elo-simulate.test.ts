import { describe, it, expect } from 'vitest'

import { mulberry32, meterMoveSamples, simulateSeasons, expectedMeterDelta, type SimInput } from '@/match/elo/elo-simulate'

describe('mulberry32', () => {
  it('is deterministic per seed and uniform-ish in [0, 1)', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 5 }, () => a())
    const seqB = Array.from({ length: 5 }, () => b())
    expect(seqA).toEqual(seqB)
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true)
    // A different seed diverges.
    const c = mulberry32(43)
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(seqA)
  })
})

describe('meterMoveSamples', () => {
  it('pools signed moves by result with the meter-seeding exclusions', () => {
    const rec = (result: string, cp: number | undefined, mods: string[] = []) =>
      ({ data: { result, change_percent: cp, modifiers: mods } }) as never
    const rows = [
      rec('victory', 22),
      rec('victory', -18), // mis-signed OCR read → signed BY RESULT → +18
      rec('defeat', -20),
      rec('defeat', 25), // → −25
      rec('victory', 0), // exact zero excluded
      rec('victory', undefined), // missing excluded
      rec('victory', 35, ['victory', 'calibration']), // calibration excluded
      rec('draw', 10), // non-decisive excluded
    ]
    expect(meterMoveSamples(rows)).toEqual({ winMoves: [22, 18], lossMoves: [-20, -25] })
  })
})

describe('simulateSeasons', () => {
  const base: SimInput = {
    currentScore: 10,
    targetScore: 12,
    sampleWins: 700,
    sampleLosses: 300,
    horizonGames: 300,
    meter: { symmetricPct: 21 },
  }

  it('is exactly reproducible for a fixed seed', () => {
    const a = simulateSeasons(base, { sims: 200, seed: 7 })
    const b = simulateSeasons(base, { sims: 200, seed: 7 })
    expect(a).toEqual(b)
  })

  it('collapses to the deterministic walk when the posterior is pinned at winning', () => {
    // Overwhelming record → p ≈ 1; a single +20 move → exactly 10 games for D = 2.
    const out = simulateSeasons(
      {
        currentScore: 10, targetScore: 12, sampleWins: 1_000_000_000, sampleLosses: 0,
        horizonGames: 50, meter: { winMoves: Array<number>(8).fill(20), lossMoves: Array<number>(8).fill(-20) },
      },
      { sims: 500, seed: 1 },
    )
    expect(out.probReachTarget).toBe(1)
    expect(out.gamesToTarget.p50).toBe(10)
    expect(out.neverShare).toBe(0)
    expect(out.usedEmpiricalMeter).toBe(true)
  })

  it('reproduces the closed-form expectation under a symmetric meter', () => {
    // E[games] = D/(s_m(2p−1)) ≈ 19.4 at p ≈ 0.7, ±21%, D = 1.6.
    const out = simulateSeasons(
      { ...base, currentScore: 13.4, targetScore: 15, horizonGames: 300 },
      { sims: 4000, seed: 1 },
    )
    expect(out.usedEmpiricalMeter).toBe(false)
    expect(out.gamesToTarget.p50).not.toBeNull()
    expect(out.gamesToTarget.p50!).toBeGreaterThan(13)
    expect(out.gamesToTarget.p50!).toBeLessThan(27)
    expect(out.probReachTarget).toBeGreaterThan(0.95)
  })

  it('omitting decaySlope and rateShiftPts reproduces the legacy output bit-for-bit', () => {
    const legacy = simulateSeasons(base, { sims: 500, seed: 3 })
    const explicit = simulateSeasons({ ...base, decaySlope: 0, rateShiftPts: 0 }, { sims: 500, seed: 3 })
    expect(explicit).toEqual(legacy)
  })

  it('decay lowers the reach probability and stretches the median climb', () => {
    // p ≈ 0.7 with slope 0.03 plateaus near 20.1 — a target past the plateau
    // separates the models: the flat walk arrives comfortably inside 300
    // games, the decayed one almost never does.
    const flat = simulateSeasons({ ...base, currentScore: 13.4, targetScore: 25 }, { sims: 4000, seed: 1 })
    const decayed = simulateSeasons(
      { ...base, currentScore: 13.4, targetScore: 25, decaySlope: 0.03 },
      { sims: 4000, seed: 1 },
    )
    expect(flat.probReachTarget).toBeGreaterThan(0.9)
    expect(decayed.probReachTarget).toBeLessThan(0.1)
    expect(decayed.gamesToTarget.p50 ?? Infinity).toBeGreaterThan(flat.gamesToTarget.p50 ?? 0)
  })

  it('a decayed season plateaus near the implied true score', () => {
    // p pinned ≈ 0.7 → plateau at x0 + (p − 0.5)/s = 10 + 0.2/0.03 ≈ 16.7.
    const out = simulateSeasons(
      {
        currentScore: 10, targetScore: 30, sampleWins: 700_000_000, sampleLosses: 300_000_000,
        horizonGames: 2000, meter: { symmetricPct: 20 }, decaySlope: 0.03,
      },
      { sims: 400, seed: 1 },
    )
    expect(out.finalScore.p50).toBeGreaterThan(15.7)
    expect(out.finalScore.p50).toBeLessThan(17.7)
    expect(out.probReachTarget).toBe(0)
  })

  it('a positive rate shift raises reach; a zero shift is a no-op', () => {
    const plain = simulateSeasons({ ...base, currentScore: 13.4, targetScore: 15 }, { sims: 2000, seed: 5 })
    const zero = simulateSeasons({ ...base, currentScore: 13.4, targetScore: 15, rateShiftPts: 0 }, { sims: 2000, seed: 5 })
    const shifted = simulateSeasons(
      { ...base, currentScore: 13.4, targetScore: 15, sampleWins: 500, sampleLosses: 500, rateShiftPts: 10 },
      { sims: 2000, seed: 5 },
    )
    const unshifted = simulateSeasons(
      { ...base, currentScore: 13.4, targetScore: 15, sampleWins: 500, sampleLosses: 500 },
      { sims: 2000, seed: 5 },
    )
    expect(zero).toEqual(plain)
    expect(shifted.probReachTarget).toBeGreaterThan(unshifted.probReachTarget)
  })

  it('stays seed-deterministic with decay active', () => {
    const a = simulateSeasons({ ...base, decaySlope: 0.02, rateShiftPts: 3 }, { sims: 300, seed: 9 })
    const b = simulateSeasons({ ...base, decaySlope: 0.02, rateShiftPts: 3 }, { sims: 300, seed: 9 })
    expect(a).toEqual(b)
  })

  it('a coin-flip posterior ends lower about half the time', () => {
    const out = simulateSeasons(
      {
        currentScore: 20, targetScore: 25, sampleWins: 24, sampleLosses: 24,
        horizonGames: 100, meter: { symmetricPct: 20 },
      },
      { sims: 4000, seed: 1 },
    )
    expect(out.probEndLower).toBeGreaterThan(0.35)
    expect(out.probEndLower).toBeLessThan(0.65)
    // The far target is rarely reached at a coin-flip rate.
    expect(out.probReachTarget).toBeLessThan(0.2)
  })

  it('falls back to the symmetric meter when a pool is thin, and flags it', () => {
    const out = simulateSeasons(
      { ...base, meter: { winMoves: [20, 21, 22], lossMoves: [-20] }, symmetricFallbackPct: 21 },
      { sims: 100, seed: 1 },
    )
    expect(out.usedEmpiricalMeter).toBe(false)
  })

  it('reports never-mass and swallows quantiles the unreached share covers', () => {
    // Sub-50% posterior, big distance: most seasons never arrive.
    const out = simulateSeasons(
      {
        currentScore: 10, targetScore: 20, sampleWins: 20, sampleLosses: 30,
        horizonGames: 150, meter: { symmetricPct: 20 },
      },
      { sims: 1000, seed: 1 },
    )
    expect(out.neverShare).toBeGreaterThan(0.9)
    expect(out.gamesToTarget.p50).toBeNull()
    expect(out.gamesToTarget.p90).toBeNull()
  })

  it('emits an anchored fan with monotone quantile bands', () => {
    const out = simulateSeasons(base, { sims: 500, seed: 3, checkpoints: 10 })
    expect(out.fan.games[0]).toBe(0)
    expect(out.fan.games.length).toBe(11)
    expect(out.fan.p10[0]).toBeCloseTo(10, 10) // anchored at the current score
    for (let i = 0; i < out.fan.games.length; i++) {
      expect(out.fan.p10[i]!).toBeLessThanOrEqual(out.fan.p50[i]!)
      expect(out.fan.p50[i]!).toBeLessThanOrEqual(out.fan.p90[i]!)
    }
  })
})

describe('expectedMeterDelta', () => {
  it('is the win-weighted mean of the signed pools', () => {
    const samples = { winMoves: Array<number>(8).fill(20), lossMoves: Array<number>(8).fill(-25) }
    // 0.6·20 + 0.4·(−25) = 2 exactly.
    expect(expectedMeterDelta(samples, 0.6)).toBeCloseTo(2, 10)
  })

  it('is null when either pool is too thin to trust', () => {
    expect(expectedMeterDelta({ winMoves: [20, 21], lossMoves: Array<number>(8).fill(-20) }, 0.5)).toBeNull()
  })
})

describe('decay with asymmetric empirical pools', () => {
  it('plateaus where the closed forms now plateau: p_eff = |L|/(W+|L|)', () => {
    // Win moves +22, loss moves −19 → break-even p* = 19/41 ≈ 0.4634.
    // With p pinned ≈ 0.53 and slope 0.015, the sim's equilibrium sits at
    // x0 + (p − p*)/s ≈ 10 + 0.0666/0.015 ≈ 14.4 — the SAME plateau the
    // decay model reports once plateauRate carries the pool asymmetry.
    const out = simulateSeasons(
      {
        currentScore: 10, targetScore: 30, sampleWins: 530_000_000, sampleLosses: 470_000_000,
        horizonGames: 3000, decaySlope: 0.015,
        meter: { winMoves: Array<number>(8).fill(22), lossMoves: Array<number>(8).fill(-19) },
      },
      { sims: 300, seed: 1 },
    )
    const expected = 10 + (0.53 - 19 / 41) / 0.015
    expect(out.finalScore.p50).toBeGreaterThan(expected - 1)
    expect(out.finalScore.p50).toBeLessThan(expected + 1)
  })

  it('short horizons dedupe fan checkpoints instead of jamming at the start', () => {
    const out = simulateSeasons(
      {
        currentScore: 10, targetScore: 12, sampleWins: 1_000_000, sampleLosses: 0,
        horizonGames: 6, meter: { symmetricPct: 20 },
      },
      { sims: 50, seed: 1 },
    )
    expect(new Set(out.fan.games).size).toBe(out.fan.games.length)
    // The last checkpoint reflects real movement, not the start score.
    expect(out.fan.p50[out.fan.p50.length - 1]!).toBeGreaterThan(10)
  })
})

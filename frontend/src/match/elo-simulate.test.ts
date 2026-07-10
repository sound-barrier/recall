import { describe, it, expect } from 'vitest'

import { mulberry32, meterMoveSamples, simulateSeasons, expectedMeterDelta, type SimInput } from '@/match/elo-simulate'

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

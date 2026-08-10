import { describe, it, expect } from 'vitest'

import {
  normalCdf, binomialTwoSidedP, inverseGaussianCdf, lossStreakChance,
  betaCdf, tCdf, runsTest, logisticSlope, twoByTwoChiSquareP,
} from '@/match/elo-stats'

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
    // neighboring evaluations never jump.
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

describe('betaCdf', () => {
  it('is the identity for Beta(1,1) (uniform)', () => {
    expect(betaCdf(0.3, 1, 1)).toBeCloseTo(0.3, 10)
    expect(betaCdf(0.85, 1, 1)).toBeCloseTo(0.85, 10)
  })

  it('matches the Beta(2,2) closed form 3x² − 2x³', () => {
    expect(betaCdf(0.25, 2, 2)).toBeCloseTo(0.15625, 10)
    expect(betaCdf(0.5, 2, 2)).toBeCloseTo(0.5, 10)
    expect(betaCdf(0.75, 2, 2)).toBeCloseTo(0.84375, 10)
  })

  it('respects the reflection identity I_x(a,b) = 1 − I_{1−x}(b,a)', () => {
    expect(betaCdf(0.37, 6.5, 2.25)).toBeCloseTo(1 - betaCdf(0.63, 2.25, 6.5), 10)
  })

  it('matches the exact binomial-tail identity at half for integer shapes', () => {
    // I_½(a, b) = P(Binomial(a+b−1, ½) ≥ a). For a=61, b=41: n=101, tail from 61.
    let logTerm = 101 * Math.log(0.5)
    let below61 = 0
    for (let k = 0; k <= 60; k++) {
      below61 += Math.exp(logTerm)
      logTerm += Math.log((101 - k) / (k + 1))
    }
    expect(betaCdf(0.5, 61, 41)).toBeCloseTo(1 - below61, 9)
  })

  it('clamps the edges', () => {
    expect(betaCdf(0, 3, 4)).toBe(0)
    expect(betaCdf(1, 3, 4)).toBe(1)
    expect(betaCdf(-0.2, 3, 4)).toBe(0)
  })
})

describe('tCdf', () => {
  it('is ½ at zero for any df', () => {
    expect(tCdf(0, 1)).toBeCloseTo(0.5, 10)
    expect(tCdf(0, 30)).toBeCloseTo(0.5, 10)
  })

  it('is the Cauchy CDF at df = 1 (F(1) = ¾)', () => {
    expect(tCdf(1, 1)).toBeCloseTo(0.75, 8)
    expect(tCdf(-1, 1)).toBeCloseTo(0.25, 8)
  })

  it('approaches the normal CDF at large df', () => {
    expect(tCdf(1.96, 1e6)).toBeCloseTo(normalCdf(1.96), 4)
  })
})

describe('runsTest', () => {
  it('matches the hand-computed z for a blocky 20/20 sequence', () => {
    // Ten Ws, ten Ls, ten Ws, ten Ls → 4 runs. n1 = n2 = 20, n = 40:
    // E[R] = 1 + 2·400/40 = 21; Var = 800·760/(1600·39) = 9.7436;
    // z = (4 − 21)/√9.7436 = −5.4463.
    const seq = [
      ...Array<boolean>(10).fill(true), ...Array<boolean>(10).fill(false),
      ...Array<boolean>(10).fill(true), ...Array<boolean>(10).fill(false),
    ]
    const r = runsTest(seq)!
    expect(r.runs).toBe(4)
    expect(r.expectedRuns).toBeCloseTo(21, 10)
    expect(r.z).toBeCloseTo(-5.4463, 3)
    expect(r.pValue).toBeLessThan(0.001)
  })

  it('a perfectly alternating sequence has MORE runs than chance (z > 0)', () => {
    const seq = Array.from({ length: 40 }, (_, i) => i % 2 === 0)
    const r = runsTest(seq)!
    expect(r.runs).toBe(40)
    expect(r.z).toBeGreaterThan(0)
  })

  it('needs at least ten of each outcome', () => {
    expect(runsTest([...Array<boolean>(9).fill(true), ...Array<boolean>(30).fill(false)])).toBeNull()
    expect(runsTest([])).toBeNull()
  })
})

describe('logisticSlope', () => {
  it('recovers the exact two-point logit line from two clusters', () => {
    // 30 games at x=0 (21W/9L → logit 0.847298) and 30 at x=3 (18W/12L →
    // logit 0.405465): the saturated MLE slope is Δlogit/Δx = −0.147278.
    const xs: number[] = []
    const wins: boolean[] = []
    for (let i = 0; i < 30; i++) { xs.push(0); wins.push(i < 21) }
    for (let i = 0; i < 30; i++) { xs.push(3); wins.push(i < 18) }
    const fit = logisticSlope(xs, wins)!
    expect(fit.slope).toBeCloseTo((Math.log(18 / 12) - Math.log(21 / 9)) / 3, 6)
    // The fitted rate at the centered midpoint is σ(mean of the two logits).
    const midLogit = (Math.log(21 / 9) + Math.log(18 / 12)) / 2
    expect(fit.meanRate).toBeCloseTo(1 / (1 + Math.exp(-midLogit)), 6)
    expect(fit.se).toBeGreaterThan(0)
    expect(fit.n).toBe(60)
  })

  it('returns null on degenerate inputs', () => {
    // One class only.
    expect(logisticSlope([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], Array<boolean>(10).fill(true))).toBeNull()
    // No x spread.
    const wins = Array.from({ length: 10 }, (_, i) => i % 2 === 0)
    expect(logisticSlope(Array<number>(10).fill(2), wins)).toBeNull()
    // Too few points.
    expect(logisticSlope([0, 1], [true, false])).toBeNull()
  })

  it('returns null on complete separation instead of a runaway slope', () => {
    // All wins below x=5, all losses above — the MLE diverges.
    const xs = Array.from({ length: 20 }, (_, i) => i)
    const wins = xs.map((x) => x < 10)
    expect(logisticSlope(xs, wins)).toBeNull()
  })
})

describe('twoByTwoChiSquareP', () => {
  it('matches a hand-computed Yates chi-square', () => {
    // after-win: 30W/20L; after-loss: 15W/35L. |ad − bc| = |1050 − 300| = 750,
    // Yates: (750 − 50)² · 100 / (50·50·45·55) = 490000·100/6187500 = 7.9192;
    // p = 2(1 − Φ(√7.9192)) = 2(1 − Φ(2.8141)) ≈ 0.00489.
    const p = twoByTwoChiSquareP(30, 20, 15, 35)!
    expect(p).toBeCloseTo(0.00489, 4)
  })

  it('is 1 when the Yates-corrected difference vanishes', () => {
    expect(twoByTwoChiSquareP(10, 10, 10, 10)).toBe(1)
  })

  it('returns null when an expected cell drops below 5', () => {
    expect(twoByTwoChiSquareP(2, 30, 1, 40)).toBeNull()
    expect(twoByTwoChiSquareP(0, 0, 10, 10)).toBeNull()
  })
})

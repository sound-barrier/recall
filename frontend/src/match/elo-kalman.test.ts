import { describe, it, expect } from 'vitest'

import { skillCurve } from '@/match/elo-kalman'

function pts(scores: number[]): { t: number; score: number }[] {
  return scores.map((score, i) => ({ t: i * 1000, score }))
}

// Build a score series by cumulative-summing a repeated diff pattern.
function cumsum(start: number, pattern: number[], repeats: number): number[] {
  const out = [start]
  for (let r = 0; r < repeats; r++) {
    for (const d of pattern) out.push((out[out.length - 1] ?? 0) + d)
  }
  return out
}

describe('skillCurve', () => {
  it('matches the method-of-moments identities on alternating white noise', () => {
    // ys = 0,1,0,1,… (21 readings): diffs are ±1 with mean 0, so the sample
    // lag-1 autocovariance is exactly −1 → R = 1; var(d) = 20/19 < 2R → Q
    // clamps to ε. Pure observation noise: signalShare ≈ 0.
    const curve = skillCurve(pts(cumsum(0, [1, -1], 10)))!
    expect(curve.r).toBeCloseTo(1, 10)
    expect(curve.q).toBeCloseTo(1e-4, 12)
    expect(curve.signalShare).toBeLessThan(0.001)
    // The smoothed level hugs the series mean (~0.5) away from the edges.
    for (let i = 3; i < curve.level.length - 3; i++) {
      expect(curve.level[i]!).toBeGreaterThan(0.25)
      expect(curve.level[i]!).toBeLessThan(0.75)
    }
    expect(curve.level.length).toBe(21)
    expect(curve.halfWidth.every((w) => w > 0)).toBe(true)
  })

  it('reads a drift-dominated walk as almost all signal', () => {
    // Diff pattern [1, 0, −1, 0] has zero mean AND zero adjacent products,
    // so cov₁ = 0 exactly → R = ε; var(d) = 10/19 → Q ≈ var(d) →
    // signalShare ≈ 1: the movement IS the skill drift.
    const curve = skillCurve(pts(cumsum(10, [1, 0, -1, 0], 5)))!
    expect(curve.r).toBeCloseTo(1e-4, 12)
    expect(curve.q).toBeCloseTo(10 / 19 - 2e-4, 8)
    expect(curve.signalShare).toBeGreaterThan(0.99)
  })

  it('is null under twelve readings or on a flat series', () => {
    expect(skillCurve(pts(cumsum(0, [1, -1], 5).slice(0, 11)))).toBeNull()
    expect(skillCurve(pts(Array<number>(20).fill(14.5)))).toBeNull()
    expect(skillCurve([])).toBeNull()
  })

  it('keeps t aligned with the smoothed level', () => {
    const input = pts(cumsum(5, [1, -1], 8))
    const curve = skillCurve(input)!
    expect(curve.t).toEqual(input.map((p) => p.t))
    expect(curve.t.length).toBe(curve.level.length)
    expect(curve.t.length).toBe(curve.halfWidth.length)
  })
})

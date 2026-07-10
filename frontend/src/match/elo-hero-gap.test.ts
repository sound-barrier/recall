import { describe, it, expect } from 'vitest'

import { heroClimbGap } from '@/match/elo-hero-gap'
import type { HeroPickStat } from '@/match/elo-seed'

function stat(key: string, wins: number, losses: number, adjusted?: number): HeroPickStat {
  return {
    key,
    role: 'dps',
    wins,
    losses,
    winrate: Math.round((wins / (wins + losses)) * 100),
    adjustedWinrate: adjusted ?? null,
    marginPts: null,
    inPool: true,
    lowSample: wins + losses < 5,
  }
}

const NO_SAMPLES = { winMoves: [], lossMoves: [] }

describe('heroClimbGap', () => {
  it('prices the best-vs-worst spread with the naive fallback', () => {
    const gap = heroClimbGap(
      [stat('soldier', 14, 6), stat('sombra', 7, 13), stat('ashe', 10, 10)],
      NO_SAMPLES,
      20,
    )!
    expect(gap.best.key).toBe('soldier') // 70%
    expect(gap.worst.key).toBe('sombra') // 35%
    // (2·0.70−1)·20 = +8 pts/game; (2·0.35−1)·20 = −6; gap = 14.
    expect(gap.bestPerGamePts).toBeCloseTo(8, 6)
    expect(gap.worstPerGamePts).toBeCloseTo(-6, 6)
    expect(gap.gapPerGamePts).toBeCloseTo(14, 6)
  })

  it('uses the empirical meter pools when they are deep enough', () => {
    const samples = { winMoves: Array.from({ length: 10 }, () => 25), lossMoves: Array.from({ length: 10 }, () => -15) }
    const gap = heroClimbGap([stat('a', 14, 6), stat('b', 7, 13)], samples, 20)!
    // p·25 + (1−p)·(−15): at 70% → 13; at 35% → −1; gap = 14.
    expect(gap.bestPerGamePts).toBeCloseTo(13, 6)
    expect(gap.worstPerGamePts).toBeCloseTo(-1, 6)
  })

  it('prefers the shrunk rate when present', () => {
    const gap = heroClimbGap(
      [stat('hot', 14, 6, 58), stat('cold', 7, 13, 47)],
      NO_SAMPLES,
      20,
    )!
    expect(gap.bestPerGamePts).toBeCloseTo((2 * 0.58 - 1) * 20, 6)
    expect(gap.worstPerGamePts).toBeCloseTo((2 * 0.47 - 1) * 20, 6)
  })

  it('needs two evidenced heroes and a real spread', () => {
    // Only one hero clears the 15-decisive floor.
    expect(heroClimbGap([stat('a', 14, 6), stat('b', 5, 4)], NO_SAMPLES, 20)).toBeNull()
    // Spread under 5 points says nothing (54% vs 50%).
    expect(heroClimbGap([stat('a', 27, 23), stat('b', 10, 10)], NO_SAMPLES, 20)).toBeNull()
    expect(heroClimbGap([], NO_SAMPLES, 20)).toBeNull()
  })
})

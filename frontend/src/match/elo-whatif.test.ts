import { describe, it, expect } from 'vitest'

import { clampHeroAdjust, heroWhatIf, HERO_ADJUST_MAX, HERO_ADJUST_STEP } from '@/match/elo-whatif'
import type { HeroPickStat } from '@/match/elo-seed'

function stat(key: string, wins: number, losses: number): HeroPickStat {
  return {
    key,
    role: 'support',
    wins,
    losses,
    winrate: Math.round((wins / (wins + losses)) * 100),
    adjustedWinrate: null,
    marginPts: null,
    inPool: true,
    lowSample: wins + losses < 5,
  }
}

// The calculator-spec corpus: lucio 24 (75%), brigitte 12 (67%), ana 4 (50%),
// 40 decisive track games in total.
const STATS = [stat('lucio', 18, 6), stat('brigitte', 8, 4), stat('ana', 2, 2)]
const NONE = new Set<string>()

describe('heroWhatIf', () => {
  it('weights each nudge by the hero share of the games', () => {
    const w = heroWhatIf(STATS, NONE, 40, new Map([['lucio', 5]]))
    expect(w.deltaPts).toBeCloseTo((24 / 40) * 5, 6) // +3
    expect(w.perHero.get('lucio')).toEqual({ from: 75, to: 80 })
    expect(w.perHero.has('brigitte')).toBe(false)
  })

  it('sums nudges across heroes, sign and all', () => {
    const w = heroWhatIf(STATS, NONE, 40, new Map([['lucio', 5], ['ana', -10]]))
    expect(w.deltaPts).toBeCloseTo(3 - (4 / 40) * 10, 6) // +3 − 1 = +2
    expect(w.perHero.get('ana')).toEqual({ from: 50, to: 40 })
  })

  it('scopes to the selection: full weight inside, zero outside', () => {
    const sel = new Set(['lucio'])
    const inside = heroWhatIf(STATS, sel, 24, new Map([['lucio', 5]]))
    expect(inside.deltaPts).toBeCloseTo(5, 6) // 24/24 — the whole sample IS lucio
    const outside = heroWhatIf(STATS, sel, 24, new Map([['brigitte', 5]]))
    expect(outside.deltaPts).toBe(0)
    expect(outside.perHero.size).toBe(0)
  })

  it('clamps the adjusted hero rate into 0–100 before blending', () => {
    const hot = [stat('mercy', 49, 1)] // 98%
    const up = heroWhatIf(hot, NONE, 50, new Map([['mercy', 5]]))
    expect(up.perHero.get('mercy')).toEqual({ from: 98, to: 100 })
    expect(up.deltaPts).toBeCloseTo(2, 6) // only +2 of the +5 is real
    const cold = [stat('roadhog', 1, 32)] // 3%
    const down = heroWhatIf(cold, NONE, 33, new Map([['roadhog', -5]]))
    expect(down.perHero.get('roadhog')).toEqual({ from: 3, to: 0 })
    expect(down.deltaPts).toBeCloseTo(-3, 6)
  })

  it('never lets overlapping hero credit push the blend past the nudge itself', () => {
    // Multi-hero matches credit each hero, so per-hero games can sum past the
    // track sample — the denominator takes the larger of the two.
    const overlap = [stat('lucio', 20, 10), stat('brigitte', 10, 4)] // Σn = 44
    const w = heroWhatIf(overlap, NONE, 40, new Map([['lucio', 5], ['brigitte', 5]]))
    expect(w.deltaPts).toBeCloseTo(5, 6) // (30 + 14) / 44 × 5, not ×44/40
  })

  it('is a no-op with no nudges or no games', () => {
    expect(heroWhatIf(STATS, NONE, 40, new Map()).deltaPts).toBe(0)
    expect(heroWhatIf(STATS, NONE, 40, new Map()).perHero.size).toBe(0)
    expect(heroWhatIf([], NONE, 0, new Map([['lucio', 5]])).deltaPts).toBe(0)
  })
})

describe('clampHeroAdjust', () => {
  it('steps by ±5 and stops at ±25', () => {
    expect(clampHeroAdjust(0, 1)).toBe(HERO_ADJUST_STEP)
    expect(clampHeroAdjust(5, -1)).toBe(0)
    expect(clampHeroAdjust(HERO_ADJUST_MAX, 1)).toBe(HERO_ADJUST_MAX)
    expect(clampHeroAdjust(-HERO_ADJUST_MAX, -1)).toBe(-HERO_ADJUST_MAX)
  })
})

import { describe, it, expect } from 'vitest'

import {
  fmtRank, fmtScoreRank, fmtGames, fmtGamesRange, fmtWeeks, fmtProb, fmtPct, fmtPValue,
} from '@/components/elo/elo-format'
import type { GamesRange } from '@/match/elo-model'

describe('fmtRank / fmtScoreRank', () => {
  it('capitalizes the tier and appends the division', () => {
    expect(fmtRank('gold', 2)).toBe('Gold 2')
    expect(fmtRank('grandmaster', 5)).toBe('Grandmaster 5')
  })

  it('names the tier + division a ladder score falls in (division 1 = top)', () => {
    expect(fmtScoreRank(13.4)).toBe('Gold 2') // Gold band [10,15), 13 → division 2
    expect(fmtScoreRank(0)).toBe('Bronze 5')
    expect(fmtScoreRank(15)).toBe('Platinum 5')
    expect(fmtScoreRank(999)).toBe('Champion 1') // clamped to the top
  })
})

describe('fmtGames', () => {
  it('covers null, already-there, the cap, and the normal case', () => {
    expect(fmtGames(null)).toBe('—')
    expect(fmtGames(0)).toBe('Already there')
    expect(fmtGames(10000)).toBe('Effectively never')
    expect(fmtGames(19.05)).toBe('~20 games') // ceils
  })
})

describe('fmtGamesRange', () => {
  it('is empty when there is no lower bound', () => {
    expect(fmtGamesRange({ lower: null, upper: null }, 0)).toBe('')
  })

  it('phrases an open upper bound as a possible cold streak', () => {
    const r: GamesRange = { lower: 12.2, upper: null }
    expect(fmtGamesRange(r, 14)).toMatch(/Best case ~13;.*only 14 games.*cold streak/)
  })

  it('caps an absurd upper bound', () => {
    expect(fmtGamesRange({ lower: 5, upper: 99999 }, 40)).toMatch(/Best case ~5; an unlucky run, far longer/)
  })

  it('renders a finite best-case / unlucky spread', () => {
    expect(fmtGamesRange({ lower: 12.1, upper: 188.2 }, 40)).toBe('Best case ~13; an unlucky run ~189')
  })
})

describe('fmtWeeks', () => {
  it('covers null, the years cap, sub-10 decimals, plural, and singular', () => {
    expect(fmtWeeks(null)).toBe('')
    expect(fmtWeeks(600)).toBe('years at your current pace')
    expect(fmtWeeks(3.24)).toBe('≈ 3.2 weeks at your pace')
    expect(fmtWeeks(12.6)).toBe('≈ 13 weeks at your pace')
    expect(fmtWeeks(1)).toBe('≈ 1 week at your pace')
  })
})

describe('fmtProb', () => {
  it('softens the extremes and rounds the middle', () => {
    expect(fmtProb(null)).toBe('—')
    expect(fmtProb(0.999)).toBe('almost certain')
    expect(fmtProb(0.001)).toBe('very unlikely')
    expect(fmtProb(0.42)).toBe('42% chance')
  })
})

describe('fmtPct', () => {
  it('rounds to the requested digits, or dashes on null', () => {
    expect(fmtPct(null)).toBe('—')
    expect(fmtPct(36.6)).toBe('37%')
    expect(fmtPct(52.44, 1)).toBe('52.4%')
  })
})

describe('fmtPValue', () => {
  it('covers null, the tiny-tail floor, and the two precision bands', () => {
    expect(fmtPValue(null)).toBe('—')
    expect(fmtPValue(0.00001)).toBe('p < 0.0001')
    expect(fmtPValue(0.004)).toBe('p = 0.004')
    expect(fmtPValue(0.34)).toBe('p = 0.34')
  })
})

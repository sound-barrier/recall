import { describe, it, expect } from 'vitest'

import type { SeasonMetrics } from '@/match/compare/match-compare-helpers'
import { judgeForm } from '@/match/compare/match-form-verdict'

function metrics(over: Partial<SeasonMetrics> = {}): SeasonMetrics {
  return {
    games: 20, wins: 10, losses: 9, draws: 1,
    competitiveGames: 20, quickPlayGames: 0, roleQueueGames: 20, openQueueGames: 0,
    winratePct: 53,
    elimsPer10: 18, deathsPer10: 6, assistsPer10: 9, combatSamples: 20,
    minutesPlayed: 240, timeLabel: '4h00min',
    longestWinStreak: 3, longestLosingStreak: 2,
    roleTank: { winrate: 50, games: 10 }, roleDps: { winrate: 50, games: 6 }, roleSupport: { winrate: 50, games: 4 },
    heroPoolTank: 2, heroPoolDps: 2, heroPoolSupport: 1,
    bestHeroTank: null, bestHeroDps: null, bestHeroSupport: null,
    topMap: 'Ilios', modes: [],
    topHero: 'Reinhardt', worstHero: null,
    heroPool: 'Reinhardt',
    singleHeroGames: { winrate: 53, games: 20 }, multiHeroGames: { winrate: 0, games: 0 },
    pureHeroPoolGames: { winrate: 53, games: 20 }, outOfPoolGames: { winrate: 0, games: 0 },
    ...over,
  }
}

describe('judgeForm', () => {
  it('says TOO EARLY TO CALL when either window is under the sample floor', () => {
    const thin = metrics({ wins: 2, losses: 1 })
    expect(judgeForm(thin, metrics()).word).toBe('TOO EARLY TO CALL')
    expect(judgeForm(metrics(), thin).word).toBe('TOO EARLY TO CALL')
    expect(judgeForm(thin, thin).movers).toEqual([])
  })

  it('says SHARPER for a clear win-rate rise and names it as the top mover', () => {
    const v = judgeForm(metrics({ winratePct: 45 }), metrics({ winratePct: 60 }))
    expect(v.word).toBe('SHARPER')
    expect(v.movers[0]).toBe('Win rate +15 pts')
  })

  it('says SLIPPING when deaths climb and win rate falls', () => {
    const v = judgeForm(
      metrics({ winratePct: 55, deathsPer10: 5.5 }),
      metrics({ winratePct: 47, deathsPer10: 7.5 }),
    )
    expect(v.word).toBe('SLIPPING')
    expect(v.movers).toContain('Win rate −8 pts')
    expect(v.movers).toContain('Deaths +2.0/10')
  })

  it('says HOLDING inside the noise band', () => {
    const v = judgeForm(metrics({ winratePct: 52 }), metrics({ winratePct: 54 }))
    expect(v.word).toBe('HOLDING')
  })

  it('falling deaths count as an improvement', () => {
    const v = judgeForm(metrics({ deathsPer10: 8 }), metrics({ deathsPer10: 6 }))
    expect(v.word).toBe('SHARPER')
    expect(v.movers[0]).toBe('Deaths −2.0/10')
  })

  it('weighs rank progress when both windows carry it', () => {
    const v = judgeForm(
      metrics({ rankProgress: -1 }),
      metrics({ rankProgress: 1 }),
    )
    expect(v.word).toBe('SHARPER')
    expect(v.movers[0]).toBe('Rank +2 divs')
  })

  it('caps the subline at the three biggest movers', () => {
    const v = judgeForm(
      metrics({ winratePct: 40, deathsPer10: 8, elimsPer10: 14, assistsPer10: 7 }),
      metrics({ winratePct: 60, deathsPer10: 5, elimsPer10: 20, assistsPer10: 11 }),
    )
    expect(v.movers).toHaveLength(3)
    expect(v.movers[0]).toBe('Win rate +20 pts')
  })

  it('never emits a mover whose displayed magnitude is zero, nor lets it tip the word', () => {
    // A 0.49-division rank move rounds to 0.5 at display precision (fine), but a
    // 0.04-death wiggle rounds to 0.0 — it must neither render nor score.
    const flat = judgeForm(metrics({ deathsPer10: 6.0 }), metrics({ deathsPer10: 6.04 }))
    expect(flat.word).toBe('HOLDING')
    expect(flat.movers).toEqual([])
  })

  it('formats fractional rank moves at one decimal with display-based pluralization', () => {
    const half = judgeForm(metrics({ rankProgress: 0 }), metrics({ rankProgress: 0.5 }))
    expect(half.movers[0]).toBe('Rank +0.5 divs')
    const one = judgeForm(metrics({ rankProgress: 0 }), metrics({ rankProgress: 0.96 }))
    expect(one.movers[0]).toBe('Rank +1 div') // 0.96 rounds to 1.0 → singular
    const down = judgeForm(metrics({ rankProgress: 0.4 }), metrics({ rankProgress: -1.0 }))
    expect(down.movers[0]).toBe('Rank −1.4 divs')
  })

  it('gates combat movers on their own sample floor', () => {
    // Deaths doubled — but only 1 game in window B carried a performance block,
    // so the combat axis must not swing the verdict.
    const v = judgeForm(
      metrics({ deathsPer10: 6, combatSamples: 20 }),
      metrics({ deathsPer10: 12, combatSamples: 1 }),
    )
    expect(v.word).toBe('HOLDING')
    expect(v.movers).toEqual([])
  })
})

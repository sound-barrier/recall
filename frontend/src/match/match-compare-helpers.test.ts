import { describe, it, expect } from 'vitest'

import { compareSeasons, type SeasonMetrics } from '@/match/match-compare-helpers'

function metrics(over: Partial<SeasonMetrics> = {}): SeasonMetrics {
  return {
    games: 20, wins: 12, losses: 7, draws: 1,
    competitiveGames: 15, quickPlayGames: 5, roleQueueGames: 18, openQueueGames: 2,
    winratePct: 63,
    elimsPer10: 18.4, deathsPer10: 6.2, assistsPer10: 9.1,
    minutesPlayed: 300, timeLabel: '5h00min',
    longestWinStreak: 4, longestLosingStreak: 2,
    roleTank: { winrate: 60, games: 10 }, roleDps: { winrate: 55, games: 6 }, roleSupport: { winrate: 50, games: 4 },
    heroPoolTank: 3, heroPoolDps: 2, heroPoolSupport: 1,
    bestHeroTank: { hero: 'Reinhardt', winrate: 62, games: 8 }, bestHeroDps: null, bestHeroSupport: null,
    topMap: "King's Row", modes: [{ key: 'hybrid', label: 'Hybrid', winrate: 60, games: 10 }],
    topHero: 'Reinhardt', worstHero: null,
    ...over,
  }
}

function row(sections: ReturnType<typeof compareSeasons>, key: string) {
  const found = sections.flatMap((s) => s.rows).find((r) => r.key === key)
  if (!found) throw new Error(`no row ${key}`)
  return found
}

describe('compareSeasons', () => {
  it('groups metrics into the expected sections', () => {
    const sections = compareSeasons(metrics(), metrics())
    expect(sections.map((s) => s.title)).toEqual(['Overview', 'Combat', 'Consistency', 'Roles', 'Maps', 'Heroes'])
  })

  it('surfaces the game-count, role, and hero rows', () => {
    const keys = compareSeasons(metrics(), metrics()).flatMap((s) => s.rows.map((r) => r.key))
    for (const k of ['compGames', 'qpGames', 'roleQueue', 'openQueue', 'roleTank', 'poolDps', 'bestTank', 'topMap', 'worstHero']) {
      expect(keys).toContain(k)
    }
  })

  it('records W–L–D as a display row with no verdict', () => {
    const r = row(compareSeasons(metrics({ wins: 12, losses: 7, draws: 1 }), metrics()), 'record')
    expect(r.aDisplay).toBe('12–7–1')
    expect(r.delta).toBeNull()
    expect(r.outcome).toBeNull()
  })

  it('marks a higher win rate in B as improved (▲, percentage points)', () => {
    const rows = compareSeasons(metrics({ winratePct: 50, wins: 10, losses: 10 }), metrics({ winratePct: 60, wins: 12, losses: 8 }))
    const r = row(rows, 'winrate')
    expect(r.outcome).toBe('improved')
    expect(r.delta).toBe('▲ 10 pts')
    expect(r.aDisplay).toContain('50%')
    expect(r.aDisplay).toContain('n=20')
  })

  it('a lower death rate in B is an improvement even though the number went down', () => {
    const r = row(compareSeasons(metrics({ deathsPer10: 6.0 }), metrics({ deathsPer10: 4.0 })), 'deaths')
    expect(r.outcome).toBe('improved')
    expect(r.delta).toBe('▲ 2.0')
  })

  it('judges eliminations and assists as higher-better in both directions', () => {
    const elimsUp = row(compareSeasons(metrics({ elimsPer10: 16 }), metrics({ elimsPer10: 20 })), 'elims')
    expect(elimsUp.outcome).toBe('improved')
    expect(elimsUp.delta).toBe('▲ 4.0')
    const assistsDown = row(compareSeasons(metrics({ assistsPer10: 10 }), metrics({ assistsPer10: 8 })), 'assists')
    expect(assistsDown.outcome).toBe('regressed')
  })

  it('judges combat rows on the DISPLAYED precision, never contradicting the columns', () => {
    const tie = row(compareSeasons(metrics({ elimsPer10: 18.42 }), metrics({ elimsPer10: 18.44 })), 'elims')
    expect([tie.aDisplay, tie.bDisplay]).toEqual(['18.4', '18.4'])
    expect(tie.outcome).toBe('even')
    expect(tie.delta).toBe('even')
    const step = row(compareSeasons(metrics({ elimsPer10: 18.44 }), metrics({ elimsPer10: 18.46 })), 'elims')
    expect([step.aDisplay, step.bDisplay]).toEqual(['18.4', '18.5'])
    expect(step.delta).toBe('▲ 0.1')
  })

  it('shows neutral game counts as a signed change, never a verdict', () => {
    const r = row(compareSeasons(metrics({ competitiveGames: 15 }), metrics({ competitiveGames: 22 })), 'compGames')
    expect(r.outcome).toBe('neutral')
    expect(r.delta).toBe('+7')
  })

  it('flags the win-rate row low-sample only when a rate is shown', () => {
    const thin = compareSeasons(metrics({ wins: 2, losses: 1, winratePct: 67 }), metrics({ wins: 30, losses: 20, winratePct: 60 }))
    expect(row(thin, 'winrate').lowSample).toBe(true)
    const noRate = compareSeasons(metrics({ wins: 0, losses: 0, draws: 5, winratePct: null }), metrics({ wins: 30, losses: 20, winratePct: 60 }))
    expect(row(noRate, 'winrate').aDisplay).toBe('—')
    expect(row(noRate, 'winrate').lowSample).toBe(false)
  })

  it('keeps the unit on the time-played delta, including a zero change', () => {
    expect(row(compareSeasons(metrics({ minutesPlayed: 300 }), metrics({ minutesPlayed: 360 })), 'time').delta).toBe('+60 min')
    expect(row(compareSeasons(metrics({ minutesPlayed: 300 }), metrics({ minutesPlayed: 300 })), 'time').delta).toBe('0 min')
  })

  it('judges a longer losing streak in B as a regression (lower-better)', () => {
    const r = row(compareSeasons(metrics({ longestLosingStreak: 2 }), metrics({ longestLosingStreak: 5 })), 'longestLose')
    expect(r.outcome).toBe('regressed')
    expect(r.delta).toBe('▼ 3')
  })

  it('renders a role win rate as "% · Ng" and judges it higher-better', () => {
    const rows = compareSeasons(metrics({ roleTank: { winrate: 50, games: 10 } }), metrics({ roleTank: { winrate: 62, games: 8 } }))
    const r = row(rows, 'roleTank')
    expect(r.aDisplay).toBe('50% · 10g')
    expect(r.bDisplay).toBe('62% · 8g')
    expect(r.outcome).toBe('improved')
    expect(r.delta).toBe('▲ 12 pts')
  })

  it('shows a role not played in a column as — with no delta', () => {
    const r = row(compareSeasons(metrics({ roleSupport: { winrate: 0, games: 0 } }), metrics({ roleSupport: { winrate: 55, games: 4 } })), 'roleSupport')
    expect(r.aDisplay).toBe('—')
    expect(r.bDisplay).toBe('55% · 4g')
    expect(r.delta).toBeNull()
  })

  it('unions the game modes present in either season', () => {
    const rows = compareSeasons(
      metrics({ modes: [{ key: 'control', label: 'Control', winrate: 60, games: 5 }] }),
      metrics({ modes: [{ key: 'push', label: 'Push', winrate: 40, games: 3 }] }),
    )
    const control = row(rows, 'mode:control')
    expect(control.aDisplay).toBe('60% · 5g')
    expect(control.bDisplay).toBe('—') // not played in B
    const push = row(rows, 'mode:push')
    expect(push.aDisplay).toBe('—')
    expect(push.bDisplay).toBe('40% · 3g')
  })

  it('renders best/worst hero as a plain per-column display (no cross-hero delta)', () => {
    const rows = compareSeasons(
      metrics({ bestHeroTank: { hero: 'Reinhardt', winrate: 62, games: 8 } }),
      metrics({ bestHeroTank: { hero: 'Winston', winrate: 70, games: 6 } }),
    )
    const r = row(rows, 'bestTank')
    expect(r.aDisplay).toBe('Reinhardt · 62% · 8g')
    expect(r.bDisplay).toBe('Winston · 70% · 6g')
    expect(r.delta).toBeNull()
    expect(row(compareSeasons(metrics({ worstHero: null }), metrics()), 'worstHero').aDisplay).toBe('—')
  })
})

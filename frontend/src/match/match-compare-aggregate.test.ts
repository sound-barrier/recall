import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  bestHeroByRole, heroPoolsByRole, modeBreakdown, playlistCounts, queueCounts, topMap, worstHero,
} from '@/match/match-compare-aggregate'

const ROLE: Record<string, string> = { reinhardt: 'tank', winston: 'tank', genji: 'dps', ana: 'support', lucio: 'support' }
const heroRole = (h?: string | null) => (h ? ROLE[h] ?? '' : '')
const MODE: Record<string, string> = { kings_row: 'hybrid', ilios: 'control', rialto: 'escort' }
const mapGameMode = (m?: string | null) => (m ? MODE[m] ?? '' : '')
const id = (s?: string | null) => s ?? ''

function rec(i: number, heroes: string[], result: string, extra: { map?: string; playlist?: string; queue?: 'role' | 'open' } = {}): MatchRecord {
  return {
    match_key: `m${i}`, source_files: [`${i}.png`], queue_type: extra.queue,
    data: {
      result, map: extra.map, playlist: extra.playlist,
      heroes_played: heroes.map((h) => ({ hero: h, play_time: '10:00', percent_played: 50 })),
    },
  } as unknown as MatchRecord
}

describe('heroPoolsByRole', () => {
  it('counts distinct heroes played in each role', () => {
    const recs = [rec(1, ['reinhardt', 'genji'], 'victory'), rec(2, ['reinhardt', 'ana'], 'defeat'), rec(3, ['winston'], 'victory')]
    expect(heroPoolsByRole(recs, heroRole)).toEqual({ tank: 2, dps: 1, support: 1 })
  })
})

describe('bestHeroByRole', () => {
  // reinhardt 3W-1L (75%, 4g), genji 4W-0L (100%, 4g), winston 1W-2L (33%, 3g),
  // ana 1W-1L (only 2 decisive → below the 3-game floor).
  const recs = [
    rec(1, ['reinhardt', 'genji'], 'victory'), rec(2, ['reinhardt', 'genji'], 'victory'),
    rec(3, ['reinhardt', 'genji'], 'victory'), rec(4, ['reinhardt'], 'defeat'), rec(5, ['genji'], 'victory'),
    rec(6, ['winston', 'ana'], 'victory'), rec(7, ['winston', 'ana'], 'defeat'), rec(8, ['winston'], 'defeat'),
  ]

  it('picks the highest win-rate hero per role above the game floor', () => {
    const best = bestHeroByRole(recs, heroRole, id, 3)
    expect(best.tank).toEqual({ hero: 'reinhardt', winrate: 75, games: 4 })
    expect(best.dps).toEqual({ hero: 'genji', winrate: 100, games: 4 })
    expect(best.support).toBeNull() // ana only has 2 decisive games
  })

  it('excludes every hero when none clears the floor', () => {
    const best = bestHeroByRole([rec(1, ['reinhardt'], 'victory')], heroRole, id, 3)
    expect(best.tank).toBeNull()
  })
})

describe('worstHero', () => {
  it('picks the lowest win-rate hero above the game floor', () => {
    const recs = [
      rec(1, ['reinhardt'], 'victory'), rec(2, ['reinhardt'], 'victory'), rec(3, ['reinhardt'], 'defeat'),
      rec(4, ['winston'], 'defeat'), rec(5, ['winston'], 'defeat'), rec(6, ['winston'], 'victory'),
    ]
    // reinhardt 67% (3g), winston 33% (3g) → winston is worst.
    expect(worstHero(recs, id, 3)).toEqual({ hero: 'winston', winrate: 33, games: 3 })
  })

  it('is null when no hero clears the floor', () => {
    expect(worstHero([rec(1, ['reinhardt'], 'defeat')], id, 3)).toBeNull()
  })
})

describe('modeBreakdown', () => {
  it('reports games + win rate per game mode in canonical order, dropping empties', () => {
    const recs = [
      rec(1, ['reinhardt'], 'victory', { map: 'ilios' }), rec(2, ['reinhardt'], 'defeat', { map: 'ilios' }),
      rec(3, ['reinhardt'], 'victory', { map: 'kings_row' }),
    ]
    const modes = modeBreakdown(recs, mapGameMode)
    // Control before Hybrid in canonical order.
    expect(modes).toEqual([
      { key: 'control', label: 'Control', winrate: 50, games: 2 },
      { key: 'hybrid', label: 'Hybrid', winrate: 100, games: 1 },
    ])
  })
})

describe('topMap', () => {
  it('returns the most-played map', () => {
    const recs = [rec(1, ['reinhardt'], 'victory', { map: 'ilios' }), rec(2, ['reinhardt'], 'defeat', { map: 'ilios' }), rec(3, ['reinhardt'], 'victory', { map: 'kings_row' })]
    expect(topMap(recs, id)).toBe('ilios')
  })

  it('is null when no record has a map', () => {
    expect(topMap([rec(1, ['reinhardt'], 'victory')], id)).toBeNull()
  })
})

describe('playlistCounts + queueCounts', () => {
  it('splits by playlist and by queue-type override', () => {
    const recs = [
      rec(1, ['reinhardt'], 'victory', { playlist: 'competitive', queue: 'role' }),
      rec(2, ['reinhardt'], 'defeat', { playlist: 'competitive', queue: 'open' }),
      rec(3, ['reinhardt'], 'victory', { playlist: 'quickplay' }),
    ]
    expect(playlistCounts(recs)).toEqual({ competitive: 2, quickplay: 1 })
    expect(queueCounts(recs)).toEqual({ role: 1, open: 1 })
  })
})

import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import {
  topByCountRows,
  winrateByRows,
  modifierBreakdownRows,
  modifierRecordFor,
  withWhomRows,
  heroGameModeCells,
  topHeroesByMinutesRows,
  mostPlayedHeroRecord,
  mapRoleCells,
  mapCountRows,
  recentMatchRows,
  bestWinrateHeroRecord,
  timeOfDayBucketRows,
  dayOfWeekBucketRows,
} from '@/match/match-dossier-aggregate'

// Every kernel reads these fields through `?.` / `??`, so an
// undefined-valued key behaves identically to an absent one — the
// builder can assign optionals directly instead of spread-guarding.
function rec(opts: {
  key?: string
  result?: string
  map?: string
  hero?: string
  gameMode?: string
  role?: string
  date?: string
  finishedAt?: string
  parsedAt?: string
  playMode?: string
  queueType?: string
  playlist?: string
  modifiers?: string[]
  members?: string[]
  heroesPlayed?: { hero?: string; play_time?: string; percent_played?: number }[]
}): MatchRecord {
  return {
    match_key: opts.key ?? `m-${Math.random()}`,
    data: {
      map: opts.map,
      hero: opts.hero,
      result: opts.result,
      game_mode: opts.gameMode,
      role: opts.role,
      date: opts.date,
      finished_at: opts.finishedAt,
      playlist: opts.playlist,
      modifiers: opts.modifiers,
      heroes_played: opts.heroesPlayed,
    },
    annotation: opts.members ? { leavers: [], throwers: [], members: opts.members } : undefined,
    parsed_at: opts.parsedAt,
    play_mode: opts.playMode,
    queue_type: opts.queueType,
  } as unknown as MatchRecord
}

describe('topByCountRows', () => {
  const mapGetter = (r: MatchRecord) => r.data?.map

  it('ranks keys by count and computes share over keyed records only', () => {
    const records = [
      rec({ map: 'rialto', result: 'victory' }),
      rec({ map: 'rialto', result: 'defeat' }),
      rec({ map: 'dorado', result: 'victory' }),
      rec({ result: 'victory' }), // no map — must not dilute shares
    ]
    const rows = topByCountRows(records, mapGetter, 5)
    expect(rows).toEqual([
      { key: 'rialto', total: 2, winrate: 50, share: 67 },
      { key: 'dorado', total: 1, winrate: 100, share: 33 },
    ])
  })

  it('reports winrate 0 (not null) for an all-draw key and applies the limit', () => {
    const records = [
      rec({ map: 'rialto', result: 'draw' }),
      rec({ map: 'rialto', result: 'draw' }),
      rec({ map: 'dorado', result: 'victory' }),
    ]
    const rows = topByCountRows(records, mapGetter, 1)
    expect(rows).toEqual([{ key: 'rialto', total: 2, winrate: 0, share: 67 }])
  })

  it('returns an empty list when no record yields a key', () => {
    expect(topByCountRows([rec({ result: 'victory' })], mapGetter, 5)).toEqual([])
  })
})

describe('winrateByRows', () => {
  const heroGetter = (r: MatchRecord) => r.data?.hero

  it('ranks by Wilson lower bound so a thin perfect sample does not outrank a solid good one', () => {
    const records = [
      rec({ hero: 'mercy', result: 'victory' }),
      ...Array.from({ length: 9 }, () => rec({ hero: 'ana', result: 'victory' })),
      ...Array.from({ length: 3 }, () => rec({ hero: 'ana', result: 'defeat' })),
    ]
    const rows = winrateByRows(records, heroGetter, 1, 5)
    expect(rows.map((r) => r.key)).toEqual(['ana', 'mercy'])
    expect(rows[0]).toMatchObject({ key: 'ana', total: 12, winrate: 75, wins: 9, share: 75, lowSample: false })
    expect(rows[1]).toMatchObject({ key: 'mercy', total: 1, winrate: 100, wins: 1, share: 100, lowSample: true })
  })

  it('skips indecisive matches and enforces the minMatches gate', () => {
    const records = [
      rec({ hero: 'ana', result: 'victory' }),
      rec({ hero: 'ana', result: 'draw' }),
      rec({ hero: 'mercy', result: 'victory' }),
      rec({ hero: 'mercy', result: 'defeat' }),
    ]
    const rows = winrateByRows(records, heroGetter, 2, 5)
    expect(rows.map((r) => r.key)).toEqual(['mercy'])
    expect(rows[0]).toMatchObject({ total: 2, winrate: 50 })
  })
})

describe('modifierBreakdownRows', () => {
  it('counts a match toward every non-result modifier it carries', () => {
    const records = [
      rec({ result: 'victory', modifiers: ['win streak', 'calibration', 'victory'] }),
      rec({ result: 'defeat', modifiers: ['win streak'] }),
    ]
    const rows = modifierBreakdownRows(records, 5)
    expect(rows).toEqual([
      { key: 'win streak', total: 2, winrate: 50, share: 67 },
      { key: 'calibration', total: 1, winrate: 100, share: 33 },
    ])
  })

  it('applies the limit after ranking by frequency', () => {
    const records = [
      rec({ result: 'victory', modifiers: ['a', 'b'] }),
      rec({ result: 'victory', modifiers: ['a'] }),
    ]
    expect(modifierBreakdownRows(records, 1).map((r) => r.key)).toEqual(['a'])
  })
})

describe('modifierRecordFor', () => {
  it('returns null when the modifier never appears', () => {
    expect(modifierRecordFor([rec({ result: 'victory' })], 'uphill battle')).toBeNull()
  })

  it('reports a null winrate when only draws carried the modifier', () => {
    const records = [rec({ result: 'draw', modifiers: ['uphill battle'] })]
    expect(modifierRecordFor(records, 'uphill battle')).toEqual({ total: 1, winrate: null })
  })

  it('computes the decisive winrate over carriers', () => {
    const records = [
      rec({ result: 'victory', modifiers: ['uphill battle'] }),
      rec({ result: 'victory', modifiers: ['uphill battle'] }),
      rec({ result: 'defeat', modifiers: ['uphill battle'] }),
      rec({ result: 'victory' }),
    ]
    expect(modifierRecordFor(records, 'uphill battle')).toEqual({ total: 3, winrate: 67 })
  })
})

describe('withWhomRows', () => {
  it('credits every recorded teammate and buckets teammate-less matches as Solo', () => {
    const records = [
      rec({ result: 'victory', members: ['A', 'B'] }),
      rec({ result: 'defeat', members: ['A'] }),
      rec({ result: 'victory' }),
    ]
    const rows = withWhomRows(records, 5)
    expect(rows).toEqual([
      { key: 'A', total: 2, winrate: 50, share: 50 },
      { key: 'B', total: 1, winrate: 100, share: 25 },
      { key: 'Solo', total: 1, winrate: 100, share: 25 },
    ])
  })
})

describe('heroGameModeCells', () => {
  it('materializes a rectangular top-heroes × 6-modes grid in A→Z order with zero cells', () => {
    const records = [
      rec({ result: 'victory', gameMode: 'escort', heroesPlayed: [{ hero: 'lucio' }] }),
      rec({ result: 'defeat', gameMode: 'control', heroesPlayed: [{ hero: 'lucio' }] }),
    ]
    const cells = heroGameModeCells(records, 8, '')
    expect(cells).toHaveLength(6)
    expect(cells.map((c) => c.gameMode)).toEqual(['clash', 'control', 'escort', 'flashpoint', 'hybrid', 'push'])
    expect(cells.find((c) => c.gameMode === 'escort')).toEqual({
      hero: 'lucio', gameMode: 'escort', wins: 1, losses: 0, draws: 0, total: 1, winrate: 100,
    })
    expect(cells.find((c) => c.gameMode === 'clash')).toEqual({
      hero: 'lucio', gameMode: 'clash', wins: 0, losses: 0, draws: 0, total: 0, winrate: 0,
    })
  })

  it('credits each distinct hero in heroes_played once, falling back to data.hero only when the list is absent', () => {
    const records = [
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'ana' }, { hero: 'ana' }, { hero: 'brig' }] }),
      rec({ result: 'defeat', gameMode: 'push', hero: 'ana' }),
      // heroes_played present but hero-less: contributes nothing (no fallback)
      rec({ result: 'victory', gameMode: 'push', hero: 'ana', heroesPlayed: [{ play_time: '05:00' }] }),
    ]
    const cells = heroGameModeCells(records, 8, '')
    expect(cells.find((c) => c.hero === 'ana' && c.gameMode === 'push')).toMatchObject({ wins: 1, losses: 1, total: 2 })
    expect(cells.find((c) => c.hero === 'brig' && c.gameMode === 'push')).toMatchObject({ wins: 1, total: 1 })
  })

  it('caps the hero axis at heroLimit by play volume, then sorts rows A→Z', () => {
    const records = [
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'zen' }] }),
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'zen' }] }),
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'ana' }] }),
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'brig' }] }),
      rec({ result: 'victory', gameMode: 'push', heroesPlayed: [{ hero: 'brig' }] }),
    ]
    const heroes = [...new Set(heroGameModeCells(records, 2, '').map((c) => c.hero))]
    expect(heroes).toEqual(['brig', 'zen'])
  })

  it('drops records outside the trailing window and records without a game mode', () => {
    const records = [
      rec({ result: 'victory', gameMode: 'push', date: '2026-01-01', heroesPlayed: [{ hero: 'ana' }] }),
      rec({ result: 'victory', gameMode: 'push', date: '2026-06-01', heroesPlayed: [{ hero: 'ana' }] }),
      rec({ result: 'victory', heroesPlayed: [{ hero: 'ana' }] }),
    ]
    const cell = heroGameModeCells(records, 8, '2026-05-01').find((c) => c.hero === 'ana' && c.gameMode === 'push')
    expect(cell).toMatchObject({ total: 1 })
  })
})

describe('topHeroesByMinutesRows', () => {
  it('ranks by summed play time with share over total minutes and a formatted label', () => {
    const records = [
      rec({ result: 'victory', heroesPlayed: [{ hero: 'lucio', play_time: '10:00' }, { hero: 'ana', play_time: '5:00' }] }),
      rec({ result: 'defeat', heroesPlayed: [{ hero: 'lucio', play_time: '20:00' }] }),
    ]
    const rows = topHeroesByMinutesRows(records, 3)
    expect(rows).toEqual([
      { key: 'lucio', totalMinutes: 30, share: 86, winrate: 50, timeLabel: '30min' },
      { key: 'ana', totalMinutes: 5, share: 14, winrate: 100, timeLabel: '5min' },
    ])
  })

  it('skips entries without a parseable play_time', () => {
    const records = [
      rec({ result: 'victory', heroesPlayed: [{ hero: 'lucio' }, { hero: 'ana', play_time: 'garbage' }] }),
    ]
    expect(topHeroesByMinutesRows(records, 3)).toEqual([])
  })
})

describe('mostPlayedHeroRecord', () => {
  it('counts only matches where the hero cleared the percent-played threshold', () => {
    const records = [
      rec({ result: 'victory', heroesPlayed: [{ hero: 'lucio', percent_played: 80 }] }),
      rec({ result: 'defeat', heroesPlayed: [{ hero: 'lucio', percent_played: 10 }] }),
      rec({ result: 'defeat', heroesPlayed: [{ hero: 'ana', percent_played: 100 }] }),
    ]
    expect(mostPlayedHeroRecord(records, 'lucio', 20)).toEqual({
      key: 'lucio', winrate: 100, qualifyingMatches: 1,
    })
  })

  it('reports a null winrate when no qualifying decisive match exists', () => {
    const records = [rec({ result: 'draw', heroesPlayed: [{ hero: 'lucio', percent_played: 100 }] })]
    expect(mostPlayedHeroRecord(records, 'lucio', 20)).toEqual({
      key: 'lucio', winrate: null, qualifyingMatches: 0,
    })
  })
})

describe('mapRoleCells', () => {
  it('credits every canonical role a match touched, deduped, on that match map', () => {
    const heroRole = (h: string) => ({ lucio: 'support', dva: 'tank' })[h]
    const records = [
      rec({ result: 'victory', map: 'rialto', role: 'support', heroesPlayed: [{ hero: 'lucio' }, { hero: 'dva' }] }),
      rec({ result: 'defeat', map: 'rialto', role: 'tank' }),
      rec({ result: 'victory', role: 'tank' }), // no map — dropped
    ]
    const cells = mapRoleCells(records, heroRole, '')
    expect(cells).toEqual(expect.arrayContaining([
      { map: 'rialto', role: 'support', wins: 1, losses: 0, draws: 0, total: 1, winrate: 100 },
      { map: 'rialto', role: 'tank', wins: 1, losses: 1, draws: 0, total: 2, winrate: 50 },
    ]))
    expect(cells).toHaveLength(2)
  })

  it('ignores non-canonical roles from the record and the resolver', () => {
    const records = [rec({ result: 'victory', map: 'rialto', role: 'flex', heroesPlayed: [{ hero: 'x' }] })]
    expect(mapRoleCells(records, () => 'healer', '')).toEqual([])
  })

  it('applies the trailing-window cutoff', () => {
    const records = [
      rec({ result: 'victory', map: 'rialto', role: 'tank', date: '2026-01-01' }),
      rec({ result: 'victory', map: 'rialto', role: 'tank', date: '2026-06-01' }),
    ]
    expect(mapRoleCells(records, undefined, '2026-05-01')).toEqual([
      { map: 'rialto', role: 'tank', wins: 1, losses: 0, draws: 0, total: 1, winrate: 100 },
    ])
  })
})

describe('mapCountRows', () => {
  it('tallies W/L/D per map with a decisive winrate', () => {
    const records = [
      rec({ result: 'victory', map: 'rialto' }),
      rec({ result: 'defeat', map: 'rialto' }),
      rec({ result: 'draw', map: 'rialto' }),
      rec({ result: 'victory' }), // no map — dropped
    ]
    expect(mapCountRows(records, '')).toEqual([
      { map: 'rialto', wins: 1, losses: 1, draws: 1, total: 3, winrate: 50 },
    ])
  })
})

describe('recentMatchRows', () => {
  it('sorts newest-played first (date+finished_at, parsed_at fallback) and caps to count', () => {
    const records = [
      rec({ key: 'a', result: 'victory', map: 'rialto', date: '2026-05-01', finishedAt: '10:00' }),
      rec({ key: 'b', result: 'defeat', map: 'dorado', date: '2026-05-02', finishedAt: '09:00' }),
      rec({ key: 'c', result: 'draw', map: 'eichenwalde', parsedAt: '2026-05-03T00:00:00Z' }),
    ]
    const rows = recentMatchRows(records, 2, '')
    expect(rows.map((r) => r.matchKey)).toEqual(['c', 'b'])
  })

  it('renders mode/queue chips through the shared label helpers with empty-string fallbacks', () => {
    const rows = recentMatchRows([
      rec({ key: 'a', result: 'victory', map: 'rialto', playlist: 'competitive', queueType: 'role' }),
      rec({ key: 'b', result: 'defeat', map: 'dorado' }),
    ], 8, '')
    expect(rows.find((r) => r.matchKey === 'a')).toMatchObject({
      result: 'victory', map: 'rialto', mode: 'Competitive', queueType: 'Role Queue',
    })
    expect(rows.find((r) => r.matchKey === 'b')).toMatchObject({ mode: '', queueType: '' })
  })
})

describe('bestWinrateHeroRecord', () => {
  it('gates on percent played and qualifying decisive matches, breaking winrate ties by sample', () => {
    const records = [
      ...Array.from({ length: 3 }, () => rec({ result: 'victory', heroesPlayed: [{ hero: 'ana', percent_played: 90 }] })),
      ...Array.from({ length: 6 }, () => rec({ result: 'victory', heroesPlayed: [{ hero: 'brig', percent_played: 90 }] })),
      rec({ result: 'victory', heroesPlayed: [{ hero: 'mercy', percent_played: 90 }] }), // below minMatches
      rec({ result: 'victory', heroesPlayed: [{ hero: 'zen', percent_played: 5 }] }),    // below threshold
    ]
    expect(bestWinrateHeroRecord(records, 20, 3)).toEqual({
      key: 'brig', winrate: 100, qualifyingMatches: 6,
    })
  })

  it('returns null when no hero clears both gates', () => {
    const records = [rec({ result: 'victory', heroesPlayed: [{ hero: 'ana', percent_played: 90 }] })]
    expect(bestWinrateHeroRecord(records, 20, 3)).toBeNull()
  })
})

describe('timeOfDayBucketRows', () => {
  it('buckets by finished_at hour with share over parseable records only', () => {
    const records = [
      rec({ result: 'victory', finishedAt: '14:30' }),
      rec({ result: 'defeat', finishedAt: '15:10' }),
      rec({ result: 'victory', finishedAt: '01:00' }),
      rec({ result: 'victory' }), // no finished_at — excluded from denominator
    ]
    const rows = timeOfDayBucketRows(records, records, 6)
    expect(rows).toHaveLength(6)
    expect(rows[3]).toEqual({ label: '12–16', count: 2, share: 67, winrate: 50, wins: 1, decisive: 2 })
    expect(rows[0]).toEqual({ label: '00–04', count: 1, share: 33, winrate: 100, wins: 1, decisive: 1 })
  })

  it('keeps the volume read for every played game but judges only tally records', () => {
    const excluded = rec({ result: 'defeat', finishedAt: '14:00' })
    const kept = rec({ result: 'victory', finishedAt: '14:00' })
    const rows = timeOfDayBucketRows([excluded, kept], [kept], 6)
    expect(rows[3]).toEqual({ label: '12–16', count: 2, share: 100, winrate: 100, wins: 1, decisive: 1 })
  })

  it('reads a played-but-undecided bucket as no-sample (null), not 0%', () => {
    const rows = timeOfDayBucketRows([rec({ result: 'draw', finishedAt: '02:00' })], [], 6)
    expect(rows[0]).toMatchObject({ count: 1, winrate: null, wins: 0, decisive: 0 })
  })
})

describe('dayOfWeekBucketRows', () => {
  // 2026-05-10 is a Sunday; 2026-05-11 a Monday (read via UTC).
  it('buckets by UTC day-of-week and rotates to the requested week start', () => {
    const records = [
      rec({ result: 'victory', date: '2026-05-10' }),
      rec({ result: 'defeat', date: '2026-05-11' }),
      rec({ result: 'victory' }), // no date — skipped
    ]
    const sundayFirst = dayOfWeekBucketRows(records, records, 0)
    expect(sundayFirst.map((b) => b.label)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(sundayFirst[0]).toEqual({ label: 'Sun', count: 1, share: 50, winrate: 100, wins: 1, decisive: 1 })

    const mondayFirst = dayOfWeekBucketRows(records, records, 1)
    expect(mondayFirst.map((b) => b.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(mondayFirst[0]).toMatchObject({ label: 'Mon', count: 1, winrate: 0, wins: 0, decisive: 1 })
  })

  it('applies the exclude-tally judgment split like the time-of-day bucketer', () => {
    const excluded = rec({ result: 'defeat', date: '2026-05-10' })
    const rows = dayOfWeekBucketRows([excluded], [], 0)
    expect(rows[0]).toMatchObject({ label: 'Sun', count: 1, winrate: null, decisive: 0 })
  })
})

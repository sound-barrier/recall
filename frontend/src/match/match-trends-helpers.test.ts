import { describe, it, expect } from 'vitest'

import type { MatchResult, MatchRecord } from '@/api'
import {
  ladderScore,
  roleBucket,
  rankLadderSeries,
  rollingWinrateSeries,
  heroRollingWinrateSeries,
  mapRollingWinrateSeries,
  currentRankByRole,
  rankDeltaSeries,
  cumulativeNetRecordSeries,
  modifierFrequencySeries,
  combatSeries,
  dayTimeWinrateGrid,
  matchEpoch,
  type TrendInput,
} from '@/match/match-trends-helpers'

type QueueType = MatchRecord['queue_type']

interface Stub {
  rank?: string
  level?: number
  progress?: number
  change?: number
  role?: 'tank' | 'dps' | 'support'
  queue?: QueueType
  result?: 'victory' | 'defeat' | 'draw'
  modifiers?: string[]
}

function rec(date: string, time: string, s: Stub = {}): TrendInput {
  const data: Partial<MatchResult> = { date, finished_at: time }
  if (s.rank != null) data.rank = s.rank
  if (s.level != null) data.level = s.level
  if (s.progress != null) data.rank_progress = s.progress
  if (s.change != null) data.change_percent = s.change
  if (s.role != null) data.role = s.role
  if (s.result != null) data.result = s.result
  if (s.modifiers != null) data.modifiers = s.modifiers
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    queue_type: s.queue,
    data,
  }
}

describe('ladderScore', () => {
  it('rises monotonically up the tier ladder', () => {
    const scores = ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'champion']
      .map((tier) => ladderScore(tier, 5, 0)!)
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]!).toBeGreaterThan(scores[i - 1]!)
    }
  })

  it('treats division 1 as the top of a tier (above division 5)', () => {
    expect(ladderScore('gold', 1, 0)!).toBeGreaterThan(ladderScore('gold', 5, 0)!)
  })

  it('orders progress within a division and dips below 0 on a demotion screen', () => {
    expect(ladderScore('gold', 3, 60)!).toBeGreaterThan(ladderScore('gold', 3, 10)!)
    expect(ladderScore('gold', 1, -19)!).toBeLessThan(ladderScore('gold', 1, 0)!)
  })

  it('lands the top of a tier at 100% exactly on the next tier boundary', () => {
    expect(ladderScore('diamond', 1, 100)).toBe(ladderScore('master', 5, 0))
  })

  it('returns null for an unknown tier', () => {
    expect(ladderScore('wood', 3, 0)).toBeNull()
  })
})

describe('roleBucket', () => {
  it('splits role queue by the played role', () => {
    expect(roleBucket(rec('2026-05-10', '20:00', { queue: 'role', role: 'tank' }))).toEqual({ key: 'tank', label: 'Tank' })
    expect(roleBucket(rec('2026-05-10', '20:00', { queue: 'role', role: 'dps' }))).toEqual({ key: 'dps', label: 'DPS' })
  })

  it('collapses open queue to one line regardless of role', () => {
    expect(roleBucket(rec('2026-05-10', '20:00', { queue: 'open', role: 'support' }))).toEqual({ key: 'open', label: 'Open queue' })
  })

  it('falls back to the role when the queue is unknown, else one combined line', () => {
    expect(roleBucket(rec('2026-05-10', '20:00', { role: 'dps' })).key).toBe('dps')
    expect(roleBucket(rec('2026-05-10', '20:00', {}))).toEqual({ key: 'all', label: 'All' })
  })
})

describe('rankLadderSeries', () => {
  it('emits one line per role bucket, only for rank-bearing matches, sorted by time', () => {
    const series = rankLadderSeries([
      rec('2026-05-11', '20:00', { queue: 'role', role: 'tank', rank: 'platinum', level: 3, progress: 40, change: 22 }),
      rec('2026-05-10', '20:00', { queue: 'role', role: 'tank', rank: 'platinum', level: 4, progress: 10, change: -15 }),
      rec('2026-05-10', '21:00', { queue: 'role', role: 'dps', rank: 'gold', level: 2, progress: 80, change: 25 }),
      rec('2026-05-12', '20:00', { queue: 'role', role: 'support', result: 'victory' }), // no rank → skipped
    ])
    expect(series.map((s) => s.key)).toEqual(['tank', 'dps'])
    const tank = series[0]!
    // Sorted oldest-first; carries the tooltip fields.
    expect(tank.points.map((p) => p.level)).toEqual([4, 3])
    expect(tank.points[0]).toMatchObject({ tier: 'platinum', level: 4, progress: 10, change: -15 })
    // Platinum 3 ranks above Platinum 4 (division 1 is the top).
    expect(tank.points[1]!.score).toBeGreaterThan(tank.points[0]!.score)
  })

  it('is empty when no record carries rank data', () => {
    expect(rankLadderSeries([rec('2026-05-10', '20:00', { result: 'victory' })])).toEqual([])
  })
})

describe('rollingWinrateSeries', () => {
  it('computes a trailing win-rate per role bucket, excluding draws', () => {
    const series = rollingWinrateSeries([
      rec('2026-05-10', '20:00', { queue: 'role', role: 'tank', result: 'victory' }),
      rec('2026-05-10', '21:00', { queue: 'role', role: 'tank', result: 'defeat' }),
      rec('2026-05-10', '22:00', { queue: 'role', role: 'tank', result: 'draw' }), // excluded
      rec('2026-05-10', '20:30', { queue: 'role', role: 'dps', result: 'victory' }),
    ], 5)
    expect(series.map((s) => s.key)).toEqual(['tank', 'dps'])
    const tank = series[0]!
    expect(tank.points.map((p) => p.v)).toEqual([100, 50]) // [V]=100, [V,D]=50
    const dps = series[1]!
    expect(dps.points.map((p) => p.v)).toEqual([100])
  })

  it('is empty when there are no decisive matches', () => {
    expect(rollingWinrateSeries([rec('2026-05-10', '20:00', { result: 'draw' })], 10)).toEqual([])
  })
})

describe('currentRankByRole', () => {
  it('returns the latest rank reading per role bucket', () => {
    const now = currentRankByRole([
      rec('2026-05-10', '20:00', { queue: 'role', role: 'tank', rank: 'gold', level: 3, progress: 40 }),
      rec('2026-05-12', '20:00', { queue: 'role', role: 'tank', rank: 'platinum', level: 5, progress: 10 }), // newest tank
      rec('2026-05-11', '20:00', { queue: 'role', role: 'dps', rank: 'silver', level: 2, progress: 80 }),
      rec('2026-05-09', '20:00', { queue: 'role', role: 'support', result: 'victory' }), // no rank → skipped
    ])
    expect(now.map((r) => r.key)).toEqual(['tank', 'dps'])
    expect(now[0]).toMatchObject({ key: 'tank', tier: 'platinum', level: 5, progress: 10 })
    expect(now[1]).toMatchObject({ key: 'dps', tier: 'silver', level: 2 })
  })

  it('is empty when no record carries a rank', () => {
    expect(currentRankByRole([rec('2026-05-10', '20:00', { result: 'victory' })])).toEqual([])
  })
})

describe('rankDeltaSeries', () => {
  it('emits the signed per-match change% per role, rank-bearing matches only', () => {
    const series = rankDeltaSeries([
      rec('2026-05-10', '20:00', { queue: 'role', role: 'tank', rank: 'gold', level: 3, change: 22 }),
      rec('2026-05-11', '20:00', { queue: 'role', role: 'tank', rank: 'gold', level: 3, change: -18 }),
      rec('2026-05-10', '21:00', { queue: 'role', role: 'tank', result: 'victory' }), // no rank → skipped
    ])
    expect(series.map((s) => s.key)).toEqual(['tank'])
    expect(series[0]!.points.map((p) => p.v)).toEqual([22, -18])
    expect(series[0]!.points[0]!.matchKey).toContain('match-2026-05-10')
  })
})

describe('cumulativeNetRecordSeries', () => {
  it('runs a Σ(win +1 / loss −1) per role, draws ignored', () => {
    const series = cumulativeNetRecordSeries([
      rec('2026-05-10', '20:00', { queue: 'role', role: 'tank', result: 'victory' }),
      rec('2026-05-10', '21:00', { queue: 'role', role: 'tank', result: 'victory' }),
      rec('2026-05-10', '22:00', { queue: 'role', role: 'tank', result: 'defeat' }),
      rec('2026-05-10', '23:00', { queue: 'role', role: 'tank', result: 'draw' }), // ignored
    ])
    expect(series[0]!.points.map((p) => p.v)).toEqual([1, 2, 1])
  })
})

describe('modifierFrequencySeries', () => {
  it('counts each non-result modifier cumulatively, most-frequent first', () => {
    const series = modifierFrequencySeries([
      rec('2026-05-10', '20:00', { modifiers: ['underdog', 'victory'] }),
      rec('2026-05-11', '20:00', { modifiers: ['underdog', 'overcharge'] }),
      rec('2026-05-12', '20:00', { modifiers: ['defeat'] }), // result-only → no line
    ])
    // victory / defeat excluded; underdog (2) before overcharge (1).
    expect(series.map((s) => s.name)).toEqual(['underdog', 'overcharge'])
    expect(series[0]!.points.map((p) => p.v)).toEqual([1, 2]) // cumulative
  })
})

describe('matchEpoch', () => {
  it('returns null when no time can be derived', () => {
    expect(matchEpoch({ match_key: 'unmatched-foo.png', data: {} })).toBeNull()
  })
})

describe('heroRollingWinrateSeries', () => {
  function heroRec(date: string, time: string, hero: string, result: 'victory' | 'defeat'): TrendInput {
    const base = rec(date, time, { result })
    return { ...base, data: { ...base.data, hero } }
  }

  it('buckets by primary hero with one rolling series each', () => {
    const series = heroRollingWinrateSeries([
      heroRec('2026-05-01', '20:00', 'juno', 'defeat'),
      heroRec('2026-05-02', '20:00', 'juno', 'victory'),
      heroRec('2026-05-01', '21:00', 'ana', 'victory'),
    ], 10)
    const names = series.map((s) => s.name).sort()
    expect(names).toEqual(['ana', 'juno'])
    const juno = series.find((s) => s.name === 'juno')!
    expect(juno.points.map((p) => p.v)).toEqual([0, 50])
  })

  it('keeps only the top-N heroes by decisive volume', () => {
    const records: TrendInput[] = []
    for (let h = 0; h < 8; h++) {
      for (let i = 0; i <= h; i++) {
        records.push(heroRec('2026-05-01', `${String(8 + i).padStart(2, '0')}:0${h}`, `hero${h}`, 'victory'))
      }
    }
    const series = heroRollingWinrateSeries(records, 10, 3)
    expect(series).toHaveLength(3)
    expect(series.map((s) => s.name).sort()).toEqual(['hero5', 'hero6', 'hero7'])
  })

  it('skips records without a hero or a decisive result', () => {
    const base = rec('2026-05-01', '20:00', { result: 'victory' })
    const draw = heroRec('2026-05-02', '20:00', 'juno', 'victory')
    draw.data = { ...draw.data, result: 'draw' }
    expect(heroRollingWinrateSeries([base, draw], 10)).toEqual([])
  })
})

describe('mapRollingWinrateSeries', () => {
  function mapRec(date: string, time: string, map: string, result: 'victory' | 'defeat'): TrendInput {
    const base = rec(date, time, { result })
    return { ...base, data: { ...base.data, map } }
  }

  it('buckets by map with one rolling series each', () => {
    const series = mapRollingWinrateSeries([
      mapRec('2026-05-01', '20:00', 'numbani', 'defeat'),
      mapRec('2026-05-02', '20:00', 'numbani', 'victory'),
      mapRec('2026-05-01', '21:00', 'ilios', 'victory'),
    ], 10)
    expect(series.map((s) => s.name).sort()).toEqual(['ilios', 'numbani'])
    const numbani = series.find((s) => s.name === 'numbani')!
    expect(numbani.points.map((p) => p.v)).toEqual([0, 50])
  })

  it('keeps only the top-N maps by decisive volume', () => {
    const records: TrendInput[] = []
    for (let m = 0; m < 8; m++) {
      for (let i = 0; i <= m; i++) {
        records.push(mapRec('2026-05-01', `${String(8 + i).padStart(2, '0')}:0${m}`, `map${m}`, 'victory'))
      }
    }
    const series = mapRollingWinrateSeries(records, 10, 3)
    expect(series).toHaveLength(3)
    expect(series.map((s) => s.name).sort()).toEqual(['map5', 'map6', 'map7'])
  })

  it('skips records without a map or a decisive result', () => {
    const noMap = rec('2026-05-01', '20:00', { result: 'victory' })
    const draw = mapRec('2026-05-02', '20:00', 'numbani', 'victory')
    draw.data = { ...draw.data, result: 'draw' }
    expect(mapRollingWinrateSeries([noMap, draw], 10)).toEqual([])
  })
})

describe('combatSeries', () => {
  function combatRec(
    date: string,
    time: string,
    perf: Partial<Record<'eliminations' | 'deaths' | 'assists', number>>,
  ): TrendInput {
    const base = rec(date, time)
    const performance: Record<string, { total: number; avg_per_10min: number }> = {}
    for (const [k, v] of Object.entries(perf)) performance[k] = { total: v, avg_per_10min: v }
    return { ...base, data: { ...base.data, performance } }
  }

  it('emits eliminations/deaths/assists lines with per-10-min points in order', () => {
    const series = combatSeries([
      combatRec('2026-05-01', '20:00', { eliminations: 12, deaths: 4, assists: 8 }),
      combatRec('2026-05-02', '20:00', { eliminations: 20, deaths: 6, assists: 10 }),
    ])
    expect(series.map((s) => s.name)).toEqual(['Eliminations', 'Deaths', 'Assists'])
    const elims = series.find((s) => s.key === 'eliminations')!
    expect(elims.points.map((p) => p.v)).toEqual([12, 20])
  })

  it('drops a metric with no coverage and skips matches without performance', () => {
    const series = combatSeries([
      combatRec('2026-05-01', '20:00', { eliminations: 12 }), // no deaths/assists parsed
      rec('2026-05-02', '20:00', { result: 'victory' }), // no performance at all
    ])
    expect(series.map((s) => s.key)).toEqual(['eliminations'])
    expect(series[0]!.points).toHaveLength(1)
  })
})

describe('dayTimeWinrateGrid', () => {
  it('crosses day-of-week × time bucket and computes per-cell win-rate', () => {
    // 2026-05-10 is a Sunday; bucketCount 6 → 4-hour blocks.
    const grid = dayTimeWinrateGrid([
      rec('2026-05-10', '20:00', { result: 'victory' }), // Sun, 20–24
      rec('2026-05-10', '21:00', { result: 'defeat' }), // Sun, 20–24
      rec('2026-05-10', '09:00', { result: 'victory' }), // Sun, 08–12
    ], 6)
    expect(grid.bucketLabels).toEqual(['00–04', '04–08', '08–12', '12–16', '16–20', '20–24'])
    expect(grid.dayLabels).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) // weekStart 0
    expect(grid.cells.find((c) => c.y === 0 && c.x === 5)).toMatchObject({ wins: 1, total: 2, winRate: 50 })
    expect(grid.cells.find((c) => c.y === 0 && c.x === 2)).toMatchObject({ wins: 1, total: 1, winRate: 100 })
    // Empty (day, bucket) pairs are omitted entirely.
    expect(grid.cells.every((c) => c.total > 0)).toBe(true)
  })

  it('rotates rows by weekStart and skips draws + missing date/time', () => {
    // 2026-05-11 is a Monday; weekStart 1 → row 0 is Monday.
    const grid = dayTimeWinrateGrid([
      rec('2026-05-11', '20:00', { result: 'victory' }),
      rec('2026-05-11', '20:00', { result: 'draw' }), // excluded — not decisive
      rec('', '20:00', { result: 'victory' }), // no date — skipped
    ], 6, 1)
    expect(grid.dayLabels[0]).toBe('Mon')
    expect(grid.cells).toHaveLength(1)
    expect(grid.cells[0]).toMatchObject({ x: 5, y: 0, wins: 1, total: 1 })
  })
})

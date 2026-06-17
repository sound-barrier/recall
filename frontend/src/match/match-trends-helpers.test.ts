import { describe, it, expect } from 'vitest'

import type { MatchResult, MatchRecord } from '@/api'
import {
  ladderScore,
  roleBucket,
  rankLadderSeries,
  rollingWinrateSeries,
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
}

function rec(date: string, time: string, s: Stub = {}): TrendInput {
  const data: Partial<MatchResult> = { date, finished_at: time }
  if (s.rank != null) data.rank = s.rank
  if (s.level != null) data.level = s.level
  if (s.progress != null) data.rank_progress = s.progress
  if (s.change != null) data.change_percent = s.change
  if (s.role != null) data.role = s.role
  if (s.result != null) data.result = s.result
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

describe('matchEpoch', () => {
  it('returns null when no time can be derived', () => {
    expect(matchEpoch({ match_key: 'unmatched-foo.png', data: {} })).toBeNull()
  })
})

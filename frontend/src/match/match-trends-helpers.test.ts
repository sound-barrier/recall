import { describe, it, expect } from 'vitest'

import type { MatchResult } from '@/api'
import {
  matchEpoch,
  srTrendSeries,
  statTrendSeries,
  rollingWinrateSeries,
  per10TrendSeries,
  type TrendInput,
} from '@/match/match-trends-helpers'

// Build a record at a given date/time. match_key carries the same
// stamp so matchTime() resolves even when SUMMARY date is omitted.
function rec(date: string, time: string, data: Partial<MatchResult> = {}): TrendInput {
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    data: { date, finished_at: time, ...data },
  }
}

describe('matchEpoch', () => {
  it('returns null when no SUMMARY time and the match_key has no timestamp', () => {
    expect(matchEpoch({ match_key: 'unmatched-foo.png', data: {} })).toBeNull()
  })

  it('falls back to the match_key timestamp when SUMMARY date is absent', () => {
    const t = matchEpoch({ match_key: 'match-2026-05-10T22-21-11-extra', data: {} })
    expect(t).not.toBeNull()
  })
})

describe('srTrendSeries', () => {
  it('emits one chronologically-sorted line per hero, ignoring input order', () => {
    const series = srTrendSeries([
      rec('2026-05-10', '20:00', { sr: [{ hero: 'ana', sr: 2500, change: 0 }] }),
      rec('2026-05-09', '20:00', { sr: [{ hero: 'ana', sr: 2470, change: 0 }, { hero: 'kiriko', sr: 2600, change: 0 }] }),
      rec('2026-05-11', '20:00', { sr: [{ hero: 'ana', sr: 2540, change: 0 }] }),
    ])

    // Heroes sorted by name → ana, kiriko.
    expect(series.map((s) => s.name)).toEqual(['ana', 'kiriko'])
    const ana = series[0]!
    expect(ana.points.map((p) => p.v)).toEqual([2470, 2500, 2540])
    // Points ascend in time.
    expect(ana.points[0]!.t).toBeLessThan(ana.points[1]!.t)
    expect(ana.points[1]!.t).toBeLessThan(ana.points[2]!.t)
  })

  it('is empty when no record carries an SR reading', () => {
    expect(srTrendSeries([rec('2026-05-10', '20:00', { result: 'victory' })])).toEqual([])
  })
})

describe('statTrendSeries', () => {
  it('derives KDA as (elims + assists) / max(deaths, 1)', () => {
    const series = statTrendSeries(
      [rec('2026-05-10', '20:00', { eliminations: 20, assists: 10, deaths: 5 })],
      'kda',
    )
    expect(series.name).toBe('KDA')
    expect(series.points[0]!.v).toBe(6) // (20 + 10) / 5
  })

  it('treats zero deaths as one to avoid divide-by-zero', () => {
    const series = statTrendSeries(
      [rec('2026-05-10', '20:00', { eliminations: 4, assists: 0, deaths: 0 })],
      'kda',
    )
    expect(series.points[0]!.v).toBe(4)
  })

  it('reads a raw stat straight off the record and skips missing matches', () => {
    const series = statTrendSeries(
      [
        rec('2026-05-10', '20:00', { damage: 9000 }),
        rec('2026-05-11', '20:00', {}), // no damage → skipped, not plotted as 0
      ],
      'damage',
    )
    expect(series.name).toBe('Damage')
    expect(series.points.map((p) => p.v)).toEqual([9000])
  })
})

describe('rollingWinrateSeries', () => {
  it('averages over a trailing window of decisive matches, excluding draws', () => {
    const series = rollingWinrateSeries(
      [
        rec('2026-05-10', '20:00', { result: 'victory' }),
        rec('2026-05-10', '21:00', { result: 'defeat' }),
        rec('2026-05-10', '22:00', { result: 'draw' }), // excluded entirely
        rec('2026-05-10', '23:00', { result: 'victory' }),
      ],
      2,
    )
    // 3 decisive points: [V] = 100, [V,D] = 50, [D,V] = 50.
    expect(series.points.map((p) => p.v)).toEqual([100, 50, 50])
  })

  it('returns no points when there are no decisive matches', () => {
    expect(rollingWinrateSeries([rec('2026-05-10', '20:00', { result: 'draw' })], 10).points).toEqual([])
  })
})

describe('per10TrendSeries', () => {
  it('emits elims/assists/deaths-per-10 lines and drops lines with no data', () => {
    const series = per10TrendSeries([
      rec('2026-05-10', '20:00', {
        performance: {
          eliminations: { total: 20, avg_per_10min: 8.5 },
          deaths: { total: 5, avg_per_10min: 2.1 },
          // no assists → that line is dropped
        },
      }),
    ])
    expect(series.map((s) => s.name)).toEqual(['Elims / 10', 'Deaths / 10'])
    expect(series[0]!.points[0]!.v).toBe(8.5)
  })

  it('is empty when no record carries a performance block', () => {
    expect(per10TrendSeries([rec('2026-05-10', '20:00', {})])).toEqual([])
  })
})

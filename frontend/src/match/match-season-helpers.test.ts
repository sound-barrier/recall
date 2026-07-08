import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import { matchStartUTC, seasonForMatch, inSeasonWindow, seasonWindowToLocalDates } from '@/match/match-season-helpers'

function rec(data: Record<string, unknown>, key = 'm'): Pick<MatchRecord, 'match_key' | 'data'> {
  return { match_key: key, data } as Pick<MatchRecord, 'match_key' | 'data'>
}

const SEASONS: Season[] = [
  { name: 'S1', chapter: 'C', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
  { name: 'S2', chapter: 'C', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
]

describe('matchStartUTC', () => {
  it('subtracts game_length from the canonical end instant', () => {
    const got = matchStartUTC(rec({ played_at_utc: '2026-04-14T19:10:00Z', game_length: '15:00' }))
    expect(got).toBe(Date.parse('2026-04-14T18:55:00Z'))
  })
  it('uses the end instant as-is when game_length is absent', () => {
    const got = matchStartUTC(rec({ played_at_utc: '2026-04-14T19:10:00Z' }))
    expect(got).toBe(Date.parse('2026-04-14T19:10:00Z'))
  })
  it('is null when no instant is derivable', () => {
    expect(matchStartUTC(rec({}, 'unmatched-abc'))).toBeNull()
  })
})

describe('seasonForMatch (assignment by start time)', () => {
  it('a match that started before a boundary but ended after stays in the prior season', () => {
    // Ends 19:10Z (in S2 by end time) but a 15-min game started 18:55Z — S1.
    const m = rec({ played_at_utc: '2026-04-14T19:10:00Z', game_length: '15:00' })
    expect(seasonForMatch(m, SEASONS)?.name).toBe('S1')
  })
  it('a start exactly at the boundary belongs to the NEW season (half-open)', () => {
    const m = rec({ played_at_utc: '2026-04-14T19:00:00Z' }) // no length → start == boundary
    expect(seasonForMatch(m, SEASONS)?.name).toBe('S2')
  })
  it('a start one second before the boundary is the prior season', () => {
    const m = rec({ played_at_utc: '2026-04-14T18:59:59Z' })
    expect(seasonForMatch(m, SEASONS)?.name).toBe('S1')
  })
  it('a match outside every window is null', () => {
    expect(seasonForMatch(rec({ played_at_utc: '2026-01-01T00:00:00Z' }), SEASONS)).toBeNull()
  })
  it('an untimed match is null', () => {
    expect(seasonForMatch(rec({}, 'unmatched-x'), SEASONS)).toBeNull()
  })
})

describe('inSeasonWindow', () => {
  it('is half-open [start, end)', () => {
    const w = { startMs: 100, endMs: 200 }
    expect(inSeasonWindow(100, w)).toBe(true)
    expect(inSeasonWindow(199, w)).toBe(true)
    expect(inSeasonWindow(200, w)).toBe(false)
    expect(inSeasonWindow(99, w)).toBe(false)
  })
})

describe('seasonWindowToLocalDates', () => {
  // Noon-UTC instants resolve to the same calendar day in every timezone
  // from UTC-12 to UTC+11, so these bounds are stable wherever the suite runs.
  it('maps a [start, end) UTC window to inclusive local YYYY-MM-DD bounds', () => {
    const w = { startMs: Date.parse('2026-06-16T12:00:00Z'), endMs: Date.parse('2026-08-11T12:00:00Z') }
    expect(seasonWindowToLocalDates(w)).toEqual({ from: '2026-06-16', to: '2026-08-11' })
  })

  // The end is exclusive at the instant level; a mid-day end still counts its
  // own day because the last covered day is the local date of (end − 1ms).
  it('includes the end day when the season ends mid-day', () => {
    const w = { startMs: Date.parse('2026-06-16T12:00:00Z'), endMs: Date.parse('2026-06-17T12:00:00Z') }
    expect(seasonWindowToLocalDates(w)).toEqual({ from: '2026-06-16', to: '2026-06-17' })
  })
})

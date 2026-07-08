import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import type { SearchClause } from '@/match/search-query'
import {
  matchesSearch,
  matchesDateRange,
  matchesPickedSet,
  matchesHero,
  matchesRole,
  matchesTags,
  matchesMembers,
  matchesModifiers,
  matchesReviewedBy,
  matchesQueueType,
  matchesPlayMode,
  matchesSinceAnchor,
  matchesPickedSeason,
  matchesLeaverHandling,
} from '@/composables/matches/narrowPredicates'

// Minimal MatchRecord builder — each predicate reads only a small slice, so
// callers fill just the fields under test.
function rec(over: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: 'm', data: {}, ...over } as MatchRecord
}

describe('matchesSearch', () => {
  it('is inert with no clauses', () => {
    expect(matchesSearch(rec(), [])).toBe(true)
  })
  it('bare clause matches the broad lexical blob', () => {
    const r = rec({ data: { map: 'rialto', hero: 'lucio' } as MatchRecord['data'] })
    expect(matchesSearch(r, [{ field: null, value: 'rial' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'nope' } as SearchClause])).toBe(false)
  })
  it('scoped clauses only match their annotation surface', () => {
    const r = rec({ annotation: { note: 'smurf lobby', tags: ['tilt'] } as MatchRecord['annotation'] })
    expect(matchesSearch(r, [{ field: 'note', value: 'smurf' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: 'tag', value: 'tilt' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: 'note', value: 'tilt' } as SearchClause])).toBe(false)
  })
  it('all clauses AND', () => {
    const r = rec({ data: { map: 'rialto' } as MatchRecord['data'], annotation: { note: 'gg' } as MatchRecord['annotation'] })
    expect(matchesSearch(r, [{ field: null, value: 'rial' }, { field: 'note', value: 'gg' }] as SearchClause[])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'rial' }, { field: 'note', value: 'zz' }] as SearchClause[])).toBe(false)
  })
})

describe('matchesDateRange', () => {
  it('keeps undated records', () => {
    expect(matchesDateRange(rec(), '2026-01-01', '2026-12-31')).toBe(true)
  })
  it('gates on YYYY-MM-DD bounds', () => {
    const r = rec({ data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, '2026-05-01', '2026-05-31')).toBe(true)
    expect(matchesDateRange(r, '2026-06-01', '2026-06-30')).toBe(false)
  })
  it('slices T-suffixed bounds so the active day is kept', () => {
    const r = rec({ data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, '2026-05-10T00:00', '2026-05-10T23:59')).toBe(true)
  })

  it('places a summary-less tracked match by its key capture time', () => {
    // No data.date, but the key carries the screenshot capture time —
    // the same recipe (matchTime) the list sorts and displays with.
    const r = rec({ match_key: 'match-2026-05-10T19-57-14' })
    expect(matchesDateRange(r, '2026-06-01', '')).toBe(false)
    expect(matchesDateRange(r, '2026-05-01', '2026-05-31')).toBe(true)
  })

  it('sentinel rows without a capture time always pass', () => {
    expect(matchesDateRange(rec({ match_key: 'unmatched-YnJva2VuLnBuZw' }), '2026-06-01', '2026-06-30')).toBe(true)
  })

  it('a from time narrows within the from day (patch boundary)', () => {
    const at = (t: string) => rec({ data: { date: '2026-01-07', finished_at: t } as MatchRecord['data'] })
    expect(matchesDateRange(at('11:00'), '2026-01-07', '', '11:00')).toBe(true)
    expect(matchesDateRange(at('13:45'), '2026-01-07', '', '11:00')).toBe(true)
    expect(matchesDateRange(at('10:59'), '2026-01-07', '', '11:00')).toBe(false)
  })

  it('a to time keeps second-precision records inside the closing minute', () => {
    // Key-fallback stamps carry seconds; the record truncates to the
    // minute so 'to 10:59' includes 10:59:45 - the seasons phrasing
    // "to Mar 13, 10:59am" means the whole closing minute.
    const r = rec({ match_key: 'match-2026-03-13T10-59-45' })
    expect(matchesDateRange(r, '', '2026-03-13', '', '10:59')).toBe(true)
    expect(matchesDateRange(r, '2026-03-13', '', '11:00')).toBe(false)
  })

  it('a time with an empty date bound is inert', () => {
    const r = rec({ data: { date: '2026-05-10', finished_at: '09:00' } as MatchRecord['data'] })
    expect(matchesDateRange(r, '', '', '11:00', '')).toBe(true)
    expect(matchesDateRange(r, '', '', '', '08:00')).toBe(true)
  })

  it('a dated record without a time or key stamp stays date-filterable', () => {
    const r = rec({ match_key: 'm', data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, '2026-05-01', '2026-05-31')).toBe(true)
    expect(matchesDateRange(r, '2026-06-01', '')).toBe(false)
    // Against a time bound it reads as start-of-day.
    expect(matchesDateRange(r, '2026-05-10', '', '00:01')).toBe(false)
  })
})

describe('matchesPickedSet', () => {
  it('is inert with an empty set', () => {
    expect(matchesPickedSet('rialto', new Set())).toBe(true)
  })
  it('checks membership (empty string for undefined)', () => {
    expect(matchesPickedSet('rialto', new Set(['rialto']))).toBe(true)
    expect(matchesPickedSet('ilios', new Set(['rialto']))).toBe(false)
    expect(matchesPickedSet(undefined, new Set(['']))).toBe(true)
  })
})

describe('matchesHero', () => {
  it('is inert with no picked heroes', () => {
    expect(matchesHero(rec(), new Set(), 0, 0)).toBe(true)
  })
  it('broad-matches the primary hero with no threshold', () => {
    const r = rec({ data: { hero: 'lucio' } as MatchRecord['data'] })
    expect(matchesHero(r, new Set(['lucio']), 0, 0)).toBe(true)
    expect(matchesHero(r, new Set(['juno']), 0, 0)).toBe(false)
  })
  it('matches a heroes_played entry above the minute threshold', () => {
    const r = rec({ data: { hero: 'ana', heroes_played: [{ hero: 'lucio', play_time: '06:00', percent_played: 40 }] } as MatchRecord['data'] })
    expect(matchesHero(r, new Set(['lucio']), 5, 0)).toBe(true) // 6 min ≥ 5
    expect(matchesHero(r, new Set(['lucio']), 10, 0)).toBe(false) // 6 min < 10
  })
  it('with a threshold, primary-hero-only no longer qualifies', () => {
    const r = rec({ data: { hero: 'lucio' } as MatchRecord['data'] })
    expect(matchesHero(r, new Set(['lucio']), 5, 0)).toBe(false)
  })
})

describe('matchesRole', () => {
  const heroRole = (h: string | null | undefined) =>
    ({ lucio: 'support', dva: 'tank', reaper: 'dps' } as Record<string, string>)[h ?? ''] ?? ''

  it('is inert with no picked roles', () => {
    expect(matchesRole(rec(), new Set(), heroRole)).toBe(true)
  })

  it('broad-matches a SECONDARY open-queue role, not just the primary data.role', () => {
    // Primary role is support, but the match also played D.Va (tank).
    const r = rec({
      data: {
        role: 'support',
        heroes_played: [{ hero: 'lucio', percent_played: 60 }, { hero: 'dva', percent_played: 40 }],
      } as MatchRecord['data'],
    })
    expect(matchesRole(r, new Set(['tank']), heroRole)).toBe(true) // the bug: tank is secondary
    expect(matchesRole(r, new Set(['support']), heroRole)).toBe(true)
    expect(matchesRole(r, new Set(['dps']), heroRole)).toBe(false)
  })

  it('falls back to the primary role when heroes_played is empty', () => {
    const r = rec({ data: { role: 'support' } as MatchRecord['data'] })
    expect(matchesRole(r, new Set(['support']), heroRole)).toBe(true)
  })
})

describe('matchesModifiers', () => {
  const r = rec({ data: { modifiers: ['uphill battle', 'victory'] } as MatchRecord['data'] })
  it('OR semantics — surfaces a match carrying ANY picked modifier', () => {
    expect(matchesModifiers(r, new Set(['uphill battle']))).toBe(true)
    expect(matchesModifiers(r, new Set(['reversal', 'uphill battle']))).toBe(true)
    expect(matchesModifiers(r, new Set(['reversal']))).toBe(false)
  })
  it('empty pick set is inert', () => {
    expect(matchesModifiers(r, new Set())).toBe(true)
  })
  it('a match with no modifiers drops out when any pick is active', () => {
    expect(matchesModifiers(rec(), new Set(['uphill battle']))).toBe(false)
  })
})

describe('matchesTags / matchesMembers', () => {
  it('tags use OR semantics', () => {
    const r = rec({ annotation: { tags: ['tilt', 'smurf'] } as MatchRecord['annotation'] })
    expect(matchesTags(r, new Set(['tilt']))).toBe(true)
    expect(matchesTags(r, new Set(['gg']))).toBe(false)
    expect(matchesTags(r, new Set())).toBe(true)
  })
  it('members use AND semantics', () => {
    const r = rec({ annotation: { members: ['Alice', 'Bob'] } as MatchRecord['annotation'] })
    expect(matchesMembers(r, new Set(['Alice', 'Bob']))).toBe(true)
    expect(matchesMembers(r, new Set(['Alice', 'Carol']))).toBe(false)
    expect(matchesMembers(r, new Set())).toBe(true)
  })
})

describe('matchesReviewedBy', () => {
  it('buckets unreviewed records as "unreviewed"', () => {
    expect(matchesReviewedBy(rec(), new Set(['unreviewed']))).toBe(true)
    expect(matchesReviewedBy(rec({ reviewed_by: 'self' }), new Set(['unreviewed']))).toBe(false)
    expect(matchesReviewedBy(rec({ reviewed_by: 'self' }), new Set(['self']))).toBe(true)
    expect(matchesReviewedBy(rec(), new Set())).toBe(true)
  })
})

describe('matchesQueueType / matchesPlayMode', () => {
  it('are inert with an empty picked set', () => {
    expect(matchesQueueType(rec(), new Set())).toBe(true)
    expect(matchesPlayMode(rec(), new Set())).toBe(true)
  })
})

describe('matchesSinceAnchor', () => {
  it('is inert when the floor is null', () => {
    expect(matchesSinceAnchor(rec({ parsed_at: '2026-05-10T00:00:00Z' }), null)).toBe(true)
  })
  it('keeps records strictly after the anchor floor', () => {
    expect(matchesSinceAnchor(rec({ parsed_at: '2026-05-11' }), '2026-05-10')).toBe(true)
    expect(matchesSinceAnchor(rec({ parsed_at: '2026-05-09' }), '2026-05-10')).toBe(false)
  })
})

describe('matchesLeaverHandling', () => {
  it('only filters in hide mode', () => {
    const leaver = rec({ annotation: { leaver: 'team' } as MatchRecord['annotation'] })
    expect(matchesLeaverHandling(leaver, 'include')).toBe(true)
    expect(matchesLeaverHandling(leaver, 'exclude-tally')).toBe(true)
    expect(matchesLeaverHandling(leaver, 'hide')).toBe(false)
    expect(matchesLeaverHandling(rec(), 'hide')).toBe(true)
  })
})

describe('matchesPickedSeason', () => {
  const win = (name: string) =>
    name === 'S2' ? { startMs: Date.parse('2026-04-14T19:00:00Z'), endMs: Date.parse('2026-06-16T19:00:00Z') } : null

  it('is inert for an empty pick, an unknown season, and an untimed match', () => {
    const r = rec({ data: { played_at_utc: '2026-05-01T12:00:00Z' } as MatchRecord['data'] })
    expect(matchesPickedSeason(r, '', win)).toBe(true)
    expect(matchesPickedSeason(r, 'nope', win)).toBe(true)
    expect(matchesPickedSeason(rec({ match_key: 'unmatched-x', data: {} }), 'S2', win)).toBe(true)
  })
  it('keeps a match whose start falls in the picked window, drops one outside', () => {
    expect(matchesPickedSeason(rec({ data: { played_at_utc: '2026-05-01T12:00:00Z' } as MatchRecord['data'] }), 'S2', win)).toBe(true)
    expect(matchesPickedSeason(rec({ data: { played_at_utc: '2026-03-01T12:00:00Z' } as MatchRecord['data'] }), 'S2', win)).toBe(false)
  })
  it('places a boundary-straddling match by its start (prior season → dropped from the new one)', () => {
    // Ends 19:10Z (inside S2 by end) but started 18:55Z (before the boundary).
    const r = rec({ data: { played_at_utc: '2026-04-14T19:10:00Z', game_length: '15:00' } as MatchRecord['data'] })
    expect(matchesPickedSeason(r, 'S2', win)).toBe(false)
  })
})

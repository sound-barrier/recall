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
  matchesPoolSide,
  matchesSinceAnchor,
  matchesPickedSeason,
  matchesAnySide,
  matchesLeaverHandling,
} from '@/composables/matches/narrow/narrowPredicates'

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
  // Coaching writes prose onto a match from two directions, and neither was
  // searchable: the player's own timestamped moments, and the blocks a coach
  // sent back. So "find that thing the coach said about my off-angles"
  // returned nothing, which is the worst possible answer — the text is right
  // there on the match.
  it('finds a moment the player marked', () => {
    const r = rec({
      moments: [{ moment_id: 'a', match_clock: '03:23', text: 'no off-angle, tank ate it' }],
    } as Partial<MatchRecord>)
    expect(matchesSearch(r, [{ field: null, value: 'off-angle' } as SearchClause])).toBe(true)
  })

  it('finds text a coach wrote, and the focus tag they filed it under', () => {
    const r = rec({
      coach_notes: [{
        id: 1, note_id: 'n1', coach_name: 'Ordo', session_date: '2026-08-15',
        text: 'walk the high ground before the fight opens',
        focus_tags: ['positioning'],
        moments: [{ moment_id: 'm1', match_clock: '04:45', text: 'flanking Cassidy behind you' }],
      }],
    } as Partial<MatchRecord>)
    expect(matchesSearch(r, [{ field: null, value: 'high ground' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'positioning' } as SearchClause])).toBe(true)
    // A moment nested inside a returned note counts too — it is the half of a
    // timestamped review that points at something.
    expect(matchesSearch(r, [{ field: null, value: 'cassidy' } as SearchClause])).toBe(true)
    // And the coach's name, so "everything Ordo reviewed" is one search.
    expect(matchesSearch(r, [{ field: null, value: 'ordo' } as SearchClause])).toBe(true)
  })

  // The third family: what the player wrote about the match in their own
  // review sitting — text, tags, the sitting's title, the moments inside.
  it('finds what you wrote in your own review, and the review by its name', () => {
    const r = rec({
      self_review_notes: [{
        review_id: 'r1', review_title: "Tuesday's Ana games", review_created_at: '2026-08-18T19:00:00Z',
        kind: 'note', text: 'held the choke, then chased', focus_tags: ['cooldowns'], extra_tags: ['tempo'],
        moments: [{ moment_id: 'm', match_clock: '04:45', text: 'peeled late on B' }],
        updated_at: '2026-08-18T19:10:00Z',
      }],
    } as Partial<MatchRecord>)
    expect(matchesSearch(r, [{ field: null, value: 'chased' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'cooldowns' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'peeled late' } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: "tuesday's ana" } as SearchClause])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'tempo' } as SearchClause])).toBe(true)
  })

  it('still says no when the coaching text does not contain it', () => {
    const r = rec({
      moments: [{ moment_id: 'a', match_clock: '03:23', text: 'no off-angle' }],
    } as Partial<MatchRecord>)
    expect(matchesSearch(r, [{ field: null, value: 'ult tracking' } as SearchClause])).toBe(false)
  })

  it('all clauses AND', () => {
    const r = rec({ data: { map: 'rialto' } as MatchRecord['data'], annotation: { note: 'gg' } as MatchRecord['annotation'] })
    expect(matchesSearch(r, [{ field: null, value: 'rial' }, { field: 'note', value: 'gg' }] as SearchClause[])).toBe(true)
    expect(matchesSearch(r, [{ field: null, value: 'rial' }, { field: 'note', value: 'zz' }] as SearchClause[])).toBe(false)
  })
})

describe('matchesDateRange', () => {
  it('keeps undated records', () => {
    expect(matchesDateRange(rec(), { from: '2026-01-01', to: '2026-12-31' })).toBe(true)
  })
  it('gates on YYYY-MM-DD bounds', () => {
    const r = rec({ data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, { from: '2026-05-01', to: '2026-05-31' })).toBe(true)
    expect(matchesDateRange(r, { from: '2026-06-01', to: '2026-06-30' })).toBe(false)
  })
  it('slices T-suffixed bounds so the active day is kept', () => {
    const r = rec({ data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, { from: '2026-05-10T00:00', to: '2026-05-10T23:59' })).toBe(true)
  })

  it('places a summary-less tracked match by its key capture time', () => {
    // No data.date, but the key carries the screenshot capture time —
    // the same recipe (matchTime) the list sorts and displays with.
    const r = rec({ match_key: 'match-2026-05-10T19-57-14' })
    expect(matchesDateRange(r, { from: '2026-06-01', to: '' })).toBe(false)
    expect(matchesDateRange(r, { from: '2026-05-01', to: '2026-05-31' })).toBe(true)
  })

  it('sentinel rows without a capture time always pass', () => {
    expect(matchesDateRange(rec({ match_key: 'unmatched-YnJva2VuLnBuZw' }), { from: '2026-06-01', to: '2026-06-30' })).toBe(true)
  })

  it('a from time narrows within the from day (patch boundary)', () => {
    const at = (t: string) => rec({ data: { date: '2026-01-07', finished_at: t } as MatchRecord['data'] })
    expect(matchesDateRange(at('11:00'), { from: '2026-01-07', to: '', fromTime: '11:00' })).toBe(true)
    expect(matchesDateRange(at('13:45'), { from: '2026-01-07', to: '', fromTime: '11:00' })).toBe(true)
    expect(matchesDateRange(at('10:59'), { from: '2026-01-07', to: '', fromTime: '11:00' })).toBe(false)
  })

  it('a to time keeps second-precision records inside the closing minute', () => {
    // Key-fallback stamps carry seconds; the record truncates to the
    // minute so 'to 10:59' includes 10:59:45 - the seasons phrasing
    // "to Mar 13, 10:59am" means the whole closing minute.
    const r = rec({ match_key: 'match-2026-03-13T10-59-45' })
    expect(matchesDateRange(r, { from: '', to: '2026-03-13', toTime: '10:59' })).toBe(true)
    expect(matchesDateRange(r, { from: '2026-03-13', to: '', fromTime: '11:00' })).toBe(false)
  })

  it('a time with an empty date bound is inert', () => {
    const r = rec({ data: { date: '2026-05-10', finished_at: '09:00' } as MatchRecord['data'] })
    expect(matchesDateRange(r, { from: '', to: '', fromTime: '11:00' })).toBe(true)
    expect(matchesDateRange(r, { from: '', to: '', toTime: '08:00' })).toBe(true)
  })

  it('a dated record without a time or key stamp stays date-filterable', () => {
    const r = rec({ match_key: 'm', data: { date: '2026-05-10' } as MatchRecord['data'] })
    expect(matchesDateRange(r, { from: '2026-05-01', to: '2026-05-31' })).toBe(true)
    expect(matchesDateRange(r, { from: '2026-06-01', to: '' })).toBe(false)
    // Against a time bound it reads as start-of-day.
    expect(matchesDateRange(r, { from: '2026-05-10', to: '', fromTime: '00:01' })).toBe(false)
  })
})

describe('matchesSearch — disruption tokens', () => {
  const tagged = rec({
    data: { map: 'rialto' },
    annotation: { leavers: ['team'], throwers: ['enemy'] },
  } as unknown as Partial<MatchRecord>)

  it('matches a scoped leaver: / thrower: clause', () => {
    expect(matchesSearch(tagged, [{ field: 'leaver', value: 'team' }])).toBe(true)
    expect(matchesSearch(tagged, [{ field: 'leaver', value: 'enemy' }])).toBe(false)
    expect(matchesSearch(tagged, [{ field: 'thrower', value: 'enemy' }])).toBe(true)
    expect(matchesSearch(tagged, [{ field: 'thrower', value: 'team' }])).toBe(false)
  })

  it('keeps the sides OUT of the bare-token blob', () => {
    // A bare "enemy" must not match just because a side is tagged — the words
    // are too generic to fold into free-text search.
    expect(matchesSearch(tagged, [{ field: null, value: 'enemy' }])).toBe(false)
    expect(matchesSearch(tagged, [{ field: null, value: 'rialto' }])).toBe(true)
  })
})

describe('matchesAnySide', () => {
  it('is inert with an empty pick set', () => {
    expect(matchesAnySide(['team'], new Set())).toBe(true)
    expect(matchesAnySide(undefined, new Set())).toBe(true)
  })

  it('drops untagged matches once any side is picked', () => {
    expect(matchesAnySide(undefined, new Set(['team']))).toBe(false)
    expect(matchesAnySide([], new Set(['team']))).toBe(false)
  })

  it('ORs the picked sides', () => {
    expect(matchesAnySide(['team'], new Set(['team', 'enemy']))).toBe(true)
    expect(matchesAnySide(['self'], new Set(['team', 'enemy']))).toBe(false)
  })

  it('matches a both-teams tag under either picked side', () => {
    const both = ['team', 'enemy']
    expect(matchesAnySide(both, new Set(['team']))).toBe(true)
    expect(matchesAnySide(both, new Set(['enemy']))).toBe(true)
    expect(matchesAnySide(both, new Set(['self']))).toBe(false)
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

  it('buckets queue_type through the leaf label (role / open / unknown)', () => {
    const role = rec({ queue_type: 'role' } as Partial<MatchRecord>)
    const open = rec({ queue_type: 'open' } as Partial<MatchRecord>)
    const unset = rec()
    expect(matchesQueueType(role, new Set(['role'] as const))).toBe(true)
    expect(matchesQueueType(open, new Set(['role'] as const))).toBe(false)
    expect(matchesQueueType(open, new Set(['open'] as const))).toBe(true)
    // No queue_type → the explicit "unknown" bucket, and ONLY that bucket.
    expect(matchesQueueType(unset, new Set(['unknown'] as const))).toBe(true)
    expect(matchesQueueType(unset, new Set(['role', 'open'] as const))).toBe(false)
  })

  it('buckets play mode through the leaf label, including the OCR playlist fallback', () => {
    const qp = rec({ play_mode: 'quickplay' } as Partial<MatchRecord>)
    const compFallback = rec({ data: { playlist: 'competitive' } as MatchRecord['data'] })
    const unset = rec()
    expect(matchesPlayMode(qp, new Set(['quickplay'] as const))).toBe(true)
    expect(matchesPlayMode(qp, new Set(['competitive'] as const))).toBe(false)
    // What-you-see-is-what-you-filter: an OCR playlist row the leaf shows
    // as "Competitive" must pass the competitive pick.
    expect(matchesPlayMode(compFallback, new Set(['competitive'] as const))).toBe(true)
    expect(matchesPlayMode(unset, new Set(['unknown'] as const))).toBe(true)
    expect(matchesPlayMode(unset, new Set(['quickplay', 'competitive'] as const))).toBe(false)
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
    const leaver = rec({ annotation: { leavers: ['team'] } as MatchRecord['annotation'] })
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

describe('matchesPoolSide', () => {
  const heroRec = (hero: string) => ({ data: { result: 'victory', hero,
    heroes_played: [{ hero, percent_played: 100 }] } }) as unknown as MatchRecord
  const pool = { side: 'pure' as const, keys: ['reinhardt', 'lucio'], thresholdPct: 5 }

  it('passes everything when the filter is null', () => {
    expect(matchesPoolSide(heroRec('ana'), null)).toBe(true)
  })

  it('keeps only the chosen side', () => {
    expect(matchesPoolSide(heroRec('lucio'), pool)).toBe(true) // in pool → pure
    expect(matchesPoolSide(heroRec('ana'), pool)).toBe(false) // off pool → not pure
    expect(matchesPoolSide(heroRec('ana'), { ...pool, side: 'off' })).toBe(true)
    expect(matchesPoolSide(heroRec('lucio'), { ...pool, side: 'off' })).toBe(false)
  })

  it('a no-hero match matches neither side', () => {
    const noHero = { data: { result: 'victory' } } as unknown as MatchRecord
    expect(matchesPoolSide(noHero, pool)).toBe(false)
    expect(matchesPoolSide(noHero, { ...pool, side: 'off' })).toBe(false)
  })
})

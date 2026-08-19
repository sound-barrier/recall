import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import { groupReceivedReviews } from '@/match/reviews/reviews-helpers'

// A "received review" is one coach's one sitting, reassembled from the
// blocks that landed on matches — the app keeps no separate record of it.
// (coach_name, session_date) is the identity, because that is what every
// block carries and what a notes file is: one coach, one sitting.

function rec(key: string, notes: { coach: string; date: string; text?: string }[]): MatchRecord {
  return {
    match_key: key,
    source_files: [],
    data: { date: key.slice(6, 16) },
    coach_notes: notes.map((n, i) => ({
      id: i + 1, note_id: `${key}-${i}`, coach_name: n.coach, session_date: n.date,
      text: n.text ?? 'x', accepted_at: `${n.date}T09:00:00Z`,
    })),
  } as unknown as MatchRecord
}

describe('groupReceivedReviews', () => {
  it('reassembles one review per coach and sitting, newest first', () => {
    const got = groupReceivedReviews([
      rec('match-2026-08-01T20-00-00', [{ coach: 'Ordo', date: '2026-08-15' }]),
      rec('match-2026-08-02T20-00-00', [{ coach: 'Ordo', date: '2026-08-15' }, { coach: 'Vex', date: '2026-08-20' }]),
      rec('match-2026-08-03T20-00-00', [{ coach: 'Ordo', date: '2026-08-10' }]),
    ])

    expect(got.map((g) => `${g.coachName} ${g.sessionDate}`)).toEqual([
      'Vex 2026-08-20', 'Ordo 2026-08-15', 'Ordo 2026-08-10',
    ])
    const ordo15 = got[1]!
    expect(ordo15.noteCount).toBe(2)
    expect(ordo15.matchKeys).toEqual(['match-2026-08-01T20-00-00', 'match-2026-08-02T20-00-00'])
  })

  // Since the coaching-moments work a coach leaves MANY blocks on one match;
  // the count is blocks, the key list is matches — two notes on one match is
  // one card reading "2 notes · 1 match", not two cards or "2 matches".
  it('counts every note but lists each match once', () => {
    const got = groupReceivedReviews([
      rec('match-2026-08-01T20-00-00', [{ coach: 'Ordo', date: '2026-08-15' }, { coach: 'Ordo', date: '2026-08-15' }]),
    ])
    expect(got).toHaveLength(1)
    expect(got[0]!.noteCount).toBe(2)
    expect(got[0]!.matchKeys).toEqual(['match-2026-08-01T20-00-00'])
  })

  // Two coaches on one day are two sittings, in a stable order.
  it('keeps two coaches on the same day apart, and orders them by name', () => {
    const got = groupReceivedReviews([
      rec('match-2026-08-01T20-00-00', [{ coach: 'Vex', date: '2026-08-15' }, { coach: 'Ordo', date: '2026-08-15' }]),
    ])
    expect(got.map((g) => g.coachName)).toEqual(['Ordo', 'Vex'])
  })

  it('is empty when no match carries a coach block', () => {
    expect(groupReceivedReviews([rec('match-2026-08-01T20-00-00', [])])).toEqual([])
  })

  // The first noted match is the deep-link target — it must be the one the
  // coach reviewed first in THEIR reading order, which is match order, not
  // whichever record happened to be aggregated first.
  it('keeps match keys in match order within a review', () => {
    const got = groupReceivedReviews([
      rec('match-2026-08-05T20-00-00', [{ coach: 'Ordo', date: '2026-08-15' }]),
      rec('match-2026-08-01T20-00-00', [{ coach: 'Ordo', date: '2026-08-15' }]),
    ])
    expect(got[0]!.matchKeys).toEqual(['match-2026-08-01T20-00-00', 'match-2026-08-05T20-00-00'])
  })
})

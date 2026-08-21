import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import type { CoachReturnSheet, ShareExport } from '@/api'
import {
  answeringCoach, focusLine, groupReceivedReviews, notesFromLine, pluralize,
  received02Label, rosterLine, sentLine, sheetFor,
} from '@/match/reviews/reviews-helpers'

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

function sheet(over: Partial<CoachReturnSheet> = {}): CoachReturnSheet {
  return {
    id: 1, coach_name: 'Ordo', player_handle: 'Sable', session_date: '2026-08-15',
    imported_at: '2026-08-16T10:00:00Z', notes: [], focus_items: [], decisions: {},
    pending: 0, player_mismatch: false, ...over,
  } as unknown as CoachReturnSheet
}

describe('pluralize — one decision, spelled once', () => {
  it.each([
    [0, 'match', 'matches', '0 matches'],
    [1, 'match', 'matches', '1 match'],
    [2, 'match', 'matches', '2 matches'],
  ])('%i → %s', (n, one, many, want) => {
    expect(pluralize(n, one, many)).toBe(want)
  })

  // The default is the +s case, which is the shape six of the seven call sites
  // wanted and the one the old inline ternaries got wrong most often.
  it('defaults the plural to a trailing s', () => {
    expect(pluralize(1, 'note')).toBe('1 note')
    expect(pluralize(3, 'note')).toBe('3 notes')
  })
})

describe('the index label lines', () => {
  it('names how much came back and from whom', () => {
    expect(notesFromLine(1, 'Ordo')).toBe('1 note from Ordo')
    expect(notesFromLine(4, 'Ordo')).toBe('4 notes from Ordo')
  })

  it('reads a received sitting as day, notes, matches', () => {
    expect(received02Label({ sessionDate: '2026-08-15', noteCount: 1, matchKeys: ['a', 'b'] }))
      .toContain('1 note · 2 matches')
  })

  it('leaves the last-session clause off a roster row that has never sat', () => {
    expect(rosterLine({ handle: 'Sable', note_count: 2 })).toBe('Sable · 2 notes')
    expect(rosterLine({ handle: 'Sable', note_count: 1, last_note_at: '2026-08-15T10:00:00Z' }))
      .toMatch(/^Sable · 1 note · last session /)
  })

  it('counts what a share carried', () => {
    expect(sentLine({ match_keys: ['a'], exported_at: '2026-08-15T10:00:00Z' }))
      .toMatch(/^Sent 1 match · /)
  })
})

describe('finding the sheet a card came from', () => {
  const inbox = [sheet(), sheet({ id: 2, coach_name: 'Vex', session_date: '2026-08-20' })]

  it('matches on coach AND sitting date, not either alone', () => {
    expect(sheetFor(inbox, { coachName: 'Vex', sessionDate: '2026-08-20' })?.id).toBe(2)
    // Right coach, wrong sitting — a coach who has reviewed twice must not
    // hand the wrong sitting's focus items to the wrong card.
    expect(sheetFor(inbox, { coachName: 'Vex', sessionDate: '2026-08-15' })).toBeUndefined()
  })

  it('reads focus items off the sheet, since no block carries them', () => {
    const withFocus = [sheet({ focus_items: [{ item_id: 'f1', text: 'Ult timing' },
      { item_id: 'f2', text: 'Comms' }] as CoachReturnSheet['focus_items'] })]
    expect(focusLine(withFocus, { coachName: 'Ordo', sessionDate: '2026-08-15' }))
      .toBe('Ult timing · Comms')
    expect(focusLine([], { coachName: 'Ordo', sessionDate: '2026-08-15' })).toBe('')
  })
})

describe('which coach answered a sent set', () => {
  const sent = { id: 1, match_keys: ['k1', 'k2'], exported_at: '2026-08-15T10:00:00Z' } as ShareExport

  it('names the coach whose later sheet overlaps the set', () => {
    const inbox = [sheet({ imported_at: '2026-08-16T10:00:00Z', coach_name: 'Vex',
      notes: [{ match_key: 'k2' }] as CoachReturnSheet['notes'] })]
    expect(answeringCoach(inbox, [], sent)).toBe('Vex')
  })

  it('ignores a sheet that arrived BEFORE the set went out', () => {
    const inbox = [sheet({ imported_at: '2026-08-14T10:00:00Z',
      notes: [{ match_key: 'k1' }] as CoachReturnSheet['notes'] })]
    expect(answeringCoach(inbox, [], sent)).toBe('')
  })

  // A sheet can be discarded once its notes are accepted, and then the blocks
  // on the matches are the only surviving record that the answer arrived.
  it('falls back to the blocks when the sheet is gone', () => {
    expect(answeringCoach([], [{ coachName: 'Ordo', sessionDate: '2026-08-16',
      noteCount: 1, matchKeys: ['k1'] }], sent)).toBe('Ordo')
  })

  it('says nothing came back when nothing did', () => {
    expect(answeringCoach([], [], sent)).toBe('')
  })
})

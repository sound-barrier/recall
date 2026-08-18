import { describe, it, expect } from 'vitest'

import {
  clockSeconds, isPastTheEnd, matchSeconds, railPosition, sortMoments,
} from '@/match/coach/coach-cue-geometry'
import { emptyMoment, isSavable, type CoachMoment } from '@/match/coach/coach-moments'
import { notesSummaryLine, type CoachNoteDraft } from '@/match/coach/coach-notes'

const noteDraft = (text: string): CoachNoteDraft =>
  ({ kind: 'note', text, focusTags: [], extraTags: [], matchClock: '' })

const at = (clock: string, text = 'x'): CoachMoment =>
  ({ momentId: clock, matchClock: clock, text, focusTag: '' })

describe('isSavable', () => {
  // Half a moment is a draft. Sending one would store an observation that
  // either points at nothing or says nothing.
  it('needs both a readable clock and something to say', () => {
    expect(isSavable(at('4:45', 'Cassidy flanked.'))).toBe(true)
    expect(isSavable(at('4:45', '   '))).toBe(false)
    expect(isSavable({ ...emptyMoment('m'), text: 'no clock yet' })).toBe(false)
    expect(isSavable(at('4:75', 'unreadable clock'))).toBe(false)
  })
})

describe('sortMoments', () => {
  it('reads down the match', () => {
    const got = sortMoments([at('10:02'), at('3:23'), at('4:45')])
    expect(got.map((m) => m.matchClock)).toEqual(['3:23', '4:45', '10:02'])
  })

  // The bug a string sort would ship: "10:00" precedes "9:00" lexically.
  it('orders by time, not by the way a clock spells', () => {
    const got = sortMoments([at('10:00'), at('9:00')])
    expect(got.map((m) => m.matchClock)).toEqual(['9:00', '10:00'])
  })

  it('keeps the authored order when two share a second', () => {
    const first = { ...at('4:45'), momentId: 'first' }
    const second = { ...at('4:45'), momentId: 'second' }
    expect(sortMoments([first, second]).map((m) => m.momentId)).toEqual(['first', 'second'])
  })

  // A moment the app cannot place belongs where the reader will meet it.
  it('puts an unreadable clock first, not last', () => {
    const got = sortMoments([at('4:45'), at('')])
    expect(got[0]!.matchClock).toBe('')
  })
})

describe('railPosition', () => {
  it('places a moment along the match it belongs to', () => {
    expect(railPosition('4:45', '9:30')).toBeCloseTo(0.5, 1)
    expect(railPosition('0:00', '9:30')).toBe(0)
  })

  // Null, not 0. A rail that cannot be scaled must not pin every moment to
  // the top and imply they all happened at kickoff.
  it('declines to place anything when the match length never parsed', () => {
    expect(railPosition('4:45', null)).toBeNull()
    expect(railPosition('4:45', '')).toBeNull()
    expect(railPosition('4:45', 'garbled')).toBeNull()
  })

  it('clamps a stamp past the end to the bottom of the rail', () => {
    expect(railPosition('45:12', '9:30')).toBe(1)
  })
})

describe('isPastTheEnd', () => {
  it('spots a stamp longer than the match', () => {
    expect(isPastTheEnd('45:12', '9:30')).toBe(true)
    expect(isPastTheEnd('4:45', '9:30')).toBe(false)
  })

  // The app's own uncertainty must not reject the coach's work: game_length
  // is OCR-derived and absent on every manual match.
  it('says nothing when the match length is unknown', () => {
    expect(isPastTheEnd('45:12', null)).toBe(false)
    expect(isPastTheEnd('45:12', '')).toBe(false)
  })
})

describe('clockSeconds / matchSeconds', () => {
  it('reads a clock into seconds', () => {
    expect(clockSeconds('4:45')).toBe(285)
    expect(clockSeconds('04:45')).toBe(285)
    expect(clockSeconds('4:75')).toBeNull()
  })

  it('reads a match length into seconds', () => {
    expect(matchSeconds('9:30')).toBe(570)
    expect(matchSeconds(null)).toBeNull()
  })
})

describe('notesSummaryLine with moments', () => {
  // "7 notes" has always meant seven MATCHES noted. Once a coach can leave
  // three observations on one match, folding those into the same number would
  // silently answer a different question than the reader is asking.
  it('counts matches and moments separately', () => {
    const notes = { a: noteDraft('faded late'), b: noteDraft('good opening') }
    const moments = {
      a: [{ matchClock: '03:23', text: 'no off-angle' }, { matchClock: '04:13', text: 'no ult tracking' }],
      b: [{ matchClock: '01:10', text: 'strong first fight' }],
    }

    expect(notesSummaryLine(notes, 'Ordo', moments)).toBe('2 notes · 3 moments · Ordo')
  })

  it('says nothing about moments when there are none', () => {
    expect(notesSummaryLine({ a: noteDraft('faded late') }, 'Ordo')).toBe('1 note · Ordo')
  })

  // A half-typed row is a draft, not an observation — the same rule the strip
  // uses to decide whether to save one.
  it('does not count a draft that says nothing yet', () => {
    const moments = { a: [{ matchClock: '03:23', text: '   ' }, { matchClock: '', text: 'no clock yet' }] }

    expect(notesSummaryLine({ a: noteDraft('x') }, '', moments)).toBe('1 note')
  })
})

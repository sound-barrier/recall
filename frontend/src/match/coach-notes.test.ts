import { describe, it, expect } from 'vitest'

import {
  FOCUS_TAGS,
  emptyDraft,
  focusTagLabel,
  frameNameSuffix,
  fromWireNote,
  isEmptyDraft,
  noteMark,
  notesSummaryLine,
  parseMatchClock,
  tallyFocus,
  toNoteInput,
  type CoachNoteDraft,
} from '@/match/coach-notes'

function draft(over: Partial<CoachNoteDraft> = {}): CoachNoteDraft {
  return { ...emptyDraft(), ...over }
}

describe('FOCUS_TAGS + focusTagLabel', () => {
  it('is the fixed vocabulary, in the order the chips render', () => {
    expect(FOCUS_TAGS).toEqual([
      'positioning', 'ult_economy', 'target_priority', 'cooldowns', 'hero_pick', 'comms', 'mechanics', 'mental',
    ])
  })

  it('renders the human label the chips carry', () => {
    expect(FOCUS_TAGS.map(focusTagLabel)).toEqual([
      'positioning', 'ult economy', 'target priority', 'cooldowns', 'hero pick', 'comms', 'mechanics', 'mental',
    ])
  })

  it('renders a freeform extra tag as itself', () => {
    expect(focusTagLabel('tempo')).toBe('tempo')
  })
})

describe('emptyDraft / isEmptyDraft / noteMark / frameNameSuffix', () => {
  it('starts as an empty note', () => {
    expect(emptyDraft()).toEqual({ kind: 'note', text: '', focusTags: [], extraTags: [], matchClock: '' })
    expect(isEmptyDraft(emptyDraft())).toBe(true)
    expect(noteMark(emptyDraft())).toBeNull()
    expect(frameNameSuffix(emptyDraft())).toBe('')
  })

  it('treats a missing draft as nothing to mark', () => {
    expect(noteMark(undefined)).toBeNull()
    expect(frameNameSuffix(undefined)).toBe('')
  })

  it('marks a note with text as written', () => {
    const d = draft({ text: 'Peel earlier.' })
    expect(noteMark(d)).toBe('written')
    expect(frameNameSuffix(d)).toBe(' — note written')
    expect(isEmptyDraft(d)).toBe(false)
  })

  it('marks a note with only a focus tag, or only an extra tag, as written', () => {
    expect(noteMark(draft({ focusTags: ['positioning'] }))).toBe('written')
    expect(noteMark(draft({ extraTags: ['tempo'] }))).toBe('written')
  })

  it('does not count whitespace-only text or a bare clock as a note', () => {
    expect(noteMark(draft({ text: '   ' }))).toBeNull()
    expect(isEmptyDraft(draft({ text: '   ', matchClock: '04:12' }))).toBe(true)
  })

  it('marks reviewed_only as reviewed regardless of anything else', () => {
    const d = draft({ kind: 'reviewed_only' })
    expect(noteMark(d)).toBe('reviewed')
    expect(frameNameSuffix(d)).toBe(' — reviewed')
    expect(isEmptyDraft(d)).toBe(false)
  })
})

describe('parseMatchClock', () => {
  it('normalizes M:SS and MM:SS to MM:SS', () => {
    expect(parseMatchClock('4:12')).toBe('04:12')
    expect(parseMatchClock('04:12')).toBe('04:12')
    expect(parseMatchClock(' 09:59 ')).toBe('09:59')
    expect(parseMatchClock('00:00')).toBe('00:00')
  })

  it('rejects out-of-range seconds, extra digits, and junk', () => {
    expect(parseMatchClock('9:99')).toBeNull()
    expect(parseMatchClock('100:00')).toBeNull()
    expect(parseMatchClock('4:1')).toBeNull()
    expect(parseMatchClock('0412')).toBeNull()
    expect(parseMatchClock('four twelve')).toBeNull()
    expect(parseMatchClock('')).toBeNull()
  })
})

describe('tallyFocus', () => {
  it('counts every tag across the notes, most-used first, then vocabulary order, then extras', () => {
    const notes = {
      a: draft({ text: 'x', focusTags: ['cooldowns', 'positioning'], extraTags: ['tempo'] }),
      b: draft({ text: 'y', focusTags: ['cooldowns'] }),
      c: draft({ text: 'z', focusTags: ['ult_economy'], extraTags: ['tempo', 'aim'] }),
    }
    expect(tallyFocus(notes)).toEqual([
      { tag: 'cooldowns', count: 2 },
      { tag: 'tempo', count: 2 },
      { tag: 'positioning', count: 1 },
      { tag: 'ult_economy', count: 1 },
      { tag: 'aim', count: 1 },
    ])
  })

  it('is empty when nothing is tagged', () => {
    expect(tallyFocus({})).toEqual([])
    expect(tallyFocus({ a: draft({ text: 'untagged' }) })).toEqual([])
  })
})

describe('notesSummaryLine', () => {
  it('counts notes and reviewed-only marks and signs with the coach', () => {
    const notes = {
      a: draft({ text: 'one' }),
      b: draft({ kind: 'reviewed_only' }),
      c: draft({ focusTags: ['mental'] }),
    }
    expect(notesSummaryLine(notes, 'Ordo')).toBe('3 notes · 1 reviewed only · Ordo')
  })

  it('uses the singular, omits a zero reviewed count, and omits an empty coach', () => {
    expect(notesSummaryLine({ a: draft({ text: 'one' }) }, 'Ordo')).toBe('1 note · Ordo')
    expect(notesSummaryLine({ a: draft({ text: 'one' }) }, '')).toBe('1 note')
    expect(notesSummaryLine({}, '')).toBe('0 notes')
  })

  it('ignores empty drafts', () => {
    expect(notesSummaryLine({ a: draft(), b: draft({ text: 'one' }) }, '')).toBe('1 note')
  })
})

describe('toNoteInput / fromWireNote', () => {
  it('maps a draft onto the PUT body', () => {
    const d = draft({ text: 'Hold high ground.', focusTags: ['positioning'], extraTags: ['tempo'], matchClock: '04:12' })
    expect(toNoteInput(d)).toEqual({
      kind: 'note',
      text: 'Hold high ground.',
      focus_tags: ['positioning'],
      extra_tags: ['tempo'],
      match_clock: '04:12',
    })
  })

  it('round-trips through the wire shape', () => {
    const d = draft({ kind: 'reviewed_only' })
    expect(fromWireNote(toNoteInput(d))).toEqual(d)
    const written = draft({ text: 'x', focusTags: ['comms'], extraTags: [], matchClock: '' })
    expect(fromWireNote(toNoteInput(written))).toEqual(written)
  })

  it('tolerates a wire note whose optional fields are absent', () => {
    expect(fromWireNote({ kind: 'note', text: 'x' })).toEqual(draft({ text: 'x' }))
  })

  it('copies the arrays so a later edit cannot reach back into the wire object', () => {
    const wire = { kind: 'note' as const, text: '', focus_tags: ['comms'], extra_tags: [], match_clock: '' }
    const d = fromWireNote(wire)
    d.focusTags.push('mental')
    expect(wire.focus_tags).toEqual(['comms'])
  })
})

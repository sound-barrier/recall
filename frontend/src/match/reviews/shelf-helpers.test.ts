import { describe, it, expect } from 'vitest'

import type { MatchRecord, SelfReview } from '@/api'
import { shelfCard, shelfCardSpokenState } from '@/match/reviews/shelf-helpers'

function rec(key: string, result: string): MatchRecord {
  return { match_key: key, source_files: [], data: { result } } as unknown as MatchRecord
}

function sitting(over: Partial<SelfReview> = {}): SelfReview {
  return {
    review_id: 'r-1', title: '', summary: '', created_at: '2026-08-18T19:00:00Z', updated_at: '2026-08-18T19:00:00Z',
    match_keys: ['a', 'b', 'c'],
    notes: {
      a: { match_key: 'a', kind: 'note', text: 'held', focus_tags: [], extra_tags: [], match_clock: '', created_at: '', updated_at: '' },
      b: { match_key: 'b', kind: 'reviewed_only', text: '', focus_tags: [], extra_tags: [], match_clock: '', created_at: '', updated_at: '' },
    },
    ...over,
  }
}

describe('shelfCard', () => {
  it('draws one rail mark per member in the sitting order: written, reviewed, bare', () => {
    const card = shelfCard(sitting(), [rec('a', 'victory'), rec('b', 'defeat'), rec('c', 'victory')])
    expect(card.rail).toEqual(['written', 'reviewed', 'bare'])
    expect(card.writtenCount).toBe(1)
    expect(card.matchCount).toBe(3)
    expect(card.wld).toEqual({ w: 2, l: 1, d: 0 })
    expect(card.finished).toBe(false)
  })

  it('names an untitled sitting by its day and excerpts a long summary', () => {
    const card = shelfCard(sitting({ summary: 'x'.repeat(200), finished_at: '2026-08-18T20:00:00Z' }), [])
    expect(card.title).toBe('Review of 2026-08-18')
    expect(card.summaryExcerpt.length).toBe(140)
    expect(card.summaryExcerpt.endsWith('…')).toBe(true)
    expect(card.finished).toBe(true)
  })

  // A member the history no longer holds still counts as a member — the
  // sitting is about what it was over — but not in the record.
  it('tallies only the members the history still holds', () => {
    const card = shelfCard(sitting(), [rec('a', 'victory')])
    expect(card.matchCount).toBe(3)
    expect(card.wld).toEqual({ w: 1, l: 0, d: 0 })
  })

  it('speaks the state the rail only paints', () => {
    const card = shelfCard(sitting({ title: "Tuesday's Ana games" }), [rec('a', 'victory'), rec('b', 'defeat'), rec('c', 'draw')])
    expect(shelfCardSpokenState(card)).toBe('3 matches · 1 noted · 1–1–1 · in progress')
  })
})

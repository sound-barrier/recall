import { describe, expect, it, vi } from 'vitest'

import type { FocusEntry } from '@/api'
import {
  activeFocus, emptyFocusItem, insertAfter, moveBy, removeAt,
  retiredFocus, sameItems, savableItems, topFocus, withText,
} from '@/match/reviews/focus-items'

const items = [
  { item_id: 'a', text: 'hold the angle' },
  { item_id: 'b', text: 'ult economy' },
  { item_id: 'c', text: 'call the dive' },
]

describe('focus list edits', () => {
  it('mints a row with a stable id and no text', () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('11111111-2222-4333-8444-555555555555')
    expect(emptyFocusItem()).toEqual({ item_id: '11111111-2222-4333-8444-555555555555', text: '' })
  })

  it('replaces one row without touching the others', () => {
    expect(withText(items, 1, 'ult tracking')).toEqual([
      items[0], { item_id: 'b', text: 'ult tracking' }, items[2],
    ])
  })

  it('opens the next row right below the one you were in', () => {
    const next = insertAfter(items, 0)
    expect(next).toHaveLength(4)
    expect(next[1]!.text).toBe('')
    expect(next[2]).toEqual(items[1])
  })

  it('drops a row', () => {
    expect(removeAt(items, 1)).toEqual([items[0], items[2]])
  })

  it('moves a row and clamps at both ends', () => {
    expect(moveBy(items, 2, -1)).toEqual([items[0], items[2], items[1]])
    expect(moveBy(items, 0, -1)).toEqual(items)
    expect(moveBy(items, 2, 1)).toEqual(items)
  })

  it('saves the rows with words in them, trimmed', () => {
    expect(savableItems([
      { item_id: 'a', text: '  hold the angle  ' },
      { item_id: 'b', text: '   ' },
    ])).toEqual([{ item_id: 'a', text: 'hold the angle' }])
  })

  it('knows when two lists would save the same', () => {
    expect(sameItems(items, [...items])).toBe(true)
    expect(sameItems(items, withText(items, 0, 'other'))).toBe(false)
    expect(sameItems(items, removeAt(items, 0))).toBe(false)
  })
})

function entry(over: Partial<FocusEntry> = {}): FocusEntry {
  return { item_id: 'x', text: 't', status: 'working', source: 'self', from: '2026-08-18', ...over }
}

describe('what the readout says', () => {
  it('drops retired items from the live list but keeps them for the count', () => {
    const all = [entry({ item_id: '1' }), entry({ item_id: '2', status: 'done' }), entry({ item_id: '3', status: 'new' })]
    expect(activeFocus(all).map((e) => e.item_id)).toEqual(['1', '3'])
    expect(retiredFocus(all).map((e) => e.item_id)).toEqual(['2'])
  })

  it('says three, in the order it was handed', () => {
    // The server already put coach items first, each source newest first;
    // the readout must not re-sort or the band and the session disagree.
    const all = [
      entry({ item_id: 'c1', source: 'coach', status: 'new' }),
      entry({ item_id: 'c2', source: 'coach' }),
      entry({ item_id: 's1' }),
      entry({ item_id: 's2' }),
    ]
    expect(topFocus(all).map((e) => e.item_id)).toEqual(['c1', 'c2', 's1'])
  })

  it('says fewer than three when that is all there is', () => {
    expect(topFocus([entry(), entry({ item_id: 'd', status: 'done' })])).toHaveLength(1)
    expect(topFocus([])).toEqual([])
  })
})

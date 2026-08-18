import { describe, it, expect } from 'vitest'

import { viewItems, matchItems, buildPaletteItems } from '@/match/palette-items'
import { TAB_ORDER } from '@/composables/shared/keyboard/useTabKeyboardNav'

const rec = (key: string, date: string, hero = 'juno', map = 'rialto') => ({
  match_key: key,
  data: { hero, map, date, finished_at: '20:00', result: 'victory' as const },
})

describe('viewItems', () => {
  // NOT "every target is in TAB_ORDER" — viewItems maps over TAB_ORDER, so
  // that assertion is true by construction and cannot fail. What can fail is
  // the LABEL: a tab added to TAB_ORDER without a label entry is the real
  // regression, and it reaches the user as a row named "ingest" instead of
  // "Parse". So every tab must carry a label that is not merely its own id.
  it('gives every tab a human label, not its id', () => {
    const items = viewItems()

    expect(items).toHaveLength(TAB_ORDER.length)
    for (const item of items) {
      expect(item.label).not.toBe(item.target)
      expect(item.label.trim()).not.toBe('')
    }
  })

  it('labels them the way the nav does, not by id', () => {
    const elo = viewItems().find((i) => i.target === 'elo')
    expect(elo?.label).toBe('Elo Calculator')
  })
})

describe('matchItems', () => {
  // Either name finds the game: a player searching "rialto" and one searching
  // "juno" are looking for the same match.
  it('labels a match by hero and map together', () => {
    const [item] = matchItems([rec('m1', '2026-08-10', 'ana', 'ilios')])
    expect(item!.label).toContain('ana')
    expect(item!.label).toContain('ilios')
  })

  it('puts the newest first', () => {
    const items = matchItems([rec('old', '2026-08-01'), rec('new', '2026-08-15')])
    expect(items[0]!.target).toBe('new')
  })

  // The cap is the feature: scoring thousands of records on every keystroke
  // would stutter, and nobody scrolls past the first handful.
  it('caps the corpus', () => {
    const many = Array.from({ length: 500 }, (_, i) => rec(`m${i}`, '2026-08-10'))
    expect(matchItems(many).length).toBe(300)
  })

  it('falls back to the match key when a record has no hero or map', () => {
    const [item] = matchItems([{ match_key: 'bare', data: {} }])
    expect(item!.label).toBe('bare')
  })
})

describe('buildPaletteItems', () => {
  it('offers views before matches, so an empty query leads with navigation', () => {
    const items = buildPaletteItems([rec('m1', '2026-08-10')])
    expect(items[0]!.kind).toBe('view')
    expect(items.at(-1)!.kind).toBe('match')
  })
})

describe('display names', () => {
  // Every other surface prints the canonical name; a palette row showing the
  // stored slug beside them reads as debug output.
  it('renders the canonical hero and map names when resolvers are given', () => {
    const [item] = matchItems(
      [rec('m1', '2026-08-10', 'soldier 76', "king's row")],
      { hero: () => 'Soldier: 76', map: () => "King's Row" },
    )

    expect(item!.label).toBe("Soldier: 76 · King's Row")
  })

  it('falls back to the stored value when no resolver is given', () => {
    const [item] = matchItems([rec('m1', '2026-08-10', 'juno', 'rialto')])

    expect(item!.label).toBe('juno · rialto')
  })
})


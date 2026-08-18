import { describe, it, expect } from 'vitest'

import { viewItems, matchItems, buildPaletteItems } from '@/match/palette-items'
import { TAB_ORDER } from '@/composables/shared/keyboard/useTabKeyboardNav'

const rec = (key: string, date: string, hero = 'juno', map = 'rialto') => ({
  match_key: key,
  data: { hero, map, date, finished_at: '20:00', result: 'victory' as const },
})

describe('viewItems', () => {
  // Derived from TAB_ORDER so a new tab cannot silently miss the palette. If
  // this fails, someone added a tab and the palette does not know about it.
  it('offers every tab', () => {
    expect(viewItems().map((i) => i.target).sort()).toEqual([...TAB_ORDER].sort())
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

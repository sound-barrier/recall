import { describe, expect, it } from 'vitest'

import type { MatchRecord } from '@/api'
import { flagEditKind, otherReadings, withFlaggedValue } from '@/match/quality/flag-edits'

// Settling a flag by Edit or by picking the other source is the ordinary
// override write: the whole override set, rebuilt from the record AS READ,
// with the one flagged field changed. These pin that the field lands in the
// override shape its path names, and that everything already overridden
// travels with it.

function rec(data: Partial<MatchRecord['data']>, edited: string[] = []): MatchRecord {
  return {
    match_key: 'm1',
    source_files: ['a.png'],
    source: edited.length ? 'ocr_edited' : 'ocr',
    edited_fields: edited,
    data: data as MatchRecord['data'],
  }
}

describe('withFlaggedValue', () => {
  it('writes a combat number as that scalar, keeping the overrides already made', () => {
    const set = withFlaggedValue(rec({ eliminations: 74, damage: 8000 }, ['data.damage']), 'data.eliminations', '9')
    expect(set).toEqual({ eliminations: 9, damage: 8000 })
  })

  it('writes a result as its word', () => {
    expect(withFlaggedValue(rec({ result: 'victory' }), 'data.result', 'defeat')).toEqual({ result: 'defeat' })
  })

  it('rewrites one hero-stat cell', () => {
    const set = withFlaggedValue(rec({
      heroes_played: [{ hero: 'junkrat', stats: { rip_tire_kill: 40 } }],
    }), 'data.heroes_played.junkrat.stats.rip_tire_kill', '4')
    expect(set?.hero_stats).toEqual([{ hero: 'junkrat', stat_key: 'rip_tire_kill', value: 4 }])
  })

  it.each([
    ['a number that is not one', 'data.eliminations', 'x9'],
    ['a fraction of a kill', 'data.eliminations', '9.5'],
    ['an empty value', 'data.damage', ' '],
    ['a result no match has', 'data.result', 'won'],
  ])('refuses %s', (_what, field, value) => {
    expect(withFlaggedValue(rec({ eliminations: 74, damage: 1, result: 'victory' }), field, value)).toBeNull()
  })

  // Who was played is the key every other number hangs off; the review card
  // cannot rewrite it, so it offers Confirm alone and the match's own editor
  // does the rest. A hero's share and a card's SR can only be written as the
  // whole list they sit in: the hero list replaces the roster without its
  // per-hero stats, and either list settles every sibling flag inside it,
  // so they offer Confirm alone too.
  it.each([
    'data.heroes_played', 'data.heroes_played.juno', 'data.sr.juno', 'data.rank_percentile',
    'data.heroes_played.juno.percent_played', 'data.sr.juno.sr',
  ])(
    'has no edit for %s',
    (field) => {
      const r = rec({
        heroes_played: [{ hero: 'juno', percent_played: 70, stats: { orbital_ray_assists: 3 } }],
        sr: [{ hero: 'juno', sr: 1 }],
        rank_percentile: 3,
      })
      expect(flagEditKind(r, field)).toBeNull()
      expect(withFlaggedValue(r, field, '1')).toBeNull()
    },
  )
})

describe('flagEditKind', () => {
  it('asks for a number or a result', () => {
    const r = rec({ eliminations: 1, result: 'victory' })
    expect(flagEditKind(r, 'data.eliminations')).toBe('number')
    expect(flagEditKind(r, 'data.result')).toBe('result')
  })
})

describe('otherReadings', () => {
  it('offers each reading the match does not already use, once, when it can be written', () => {
    const r = rec({ eliminations: 74 })
    const flag = {
      field: 'data.eliminations', value: '74', checks: ['perf_total_vs_rate' as const], state: 'open' as const,
      readings: [
        { source_file: 'a.png', origin: 'ocr' as const, value: '74' },
        { source_file: 'a.png', origin: 'derived' as const, value: '9' },
        { source_file: 'b.png', origin: 'template' as const, value: '9' },
        { source_file: 'b.png', origin: 'template' as const, value: '?' },
      ],
    }
    expect(otherReadings(r, flag)).toEqual([{ source_file: 'a.png', origin: 'derived', value: '9' }])
  })
})

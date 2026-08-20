import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api'
import {
  overrideSetFromRecord,
  withScalarEdit,
  withStatEdit,
  withoutField,
  isEmptyOverrideSet,
  isFieldEdited,
  scalarPath,
  statPath,
} from '@/match/match-overrides'

function rec(editedFields: string[], data: Partial<MatchRecord['data']>): MatchRecord {
  return {
    match_key: 'm1',
    source_files: ['a.png'],
    source: 'ocr_edited',
    edited_fields: editedFields,
    data: data as MatchRecord['data'],
  }
}

describe('match-overrides', () => {
  it('rebuilds a scalar override from the record', () => {
    const set = overrideSetFromRecord(rec(['data.damage'], { damage: 8500 }))
    expect(set.damage).toBe(8500)
  })

  it('rebuilds a hero-stat-cell override', () => {
    const r = rec(
      ['data.heroes_played.junkrat.stats.rip_tire_kill'],
      { heroes_played: [{ hero: 'junkrat', stats: { rip_tire_kill: 4 } }] },
    )
    const set = overrideSetFromRecord(r)
    expect(set.hero_stats).toEqual([{ hero: 'junkrat', stat_key: 'rip_tire_kill', value: 4 }])
  })

  // The crux: a scalar edit must resend EVERY existing override, or the
  // wholesale PUT would silently drop the stat-grid edit.
  it('editing a scalar preserves an existing stat-grid override', () => {
    const r = rec(
      ['data.damage', 'data.heroes_played.junkrat.stats.rip_tire_kill'],
      { damage: 8500, heroes_played: [{ hero: 'junkrat', stats: { rip_tire_kill: 4 } }] },
    )
    const set = withScalarEdit(r, 'eliminations', 12)
    expect(set.eliminations).toBe(12)
    expect(set.damage).toBe(8500)
    expect(set.hero_stats).toEqual([{ hero: 'junkrat', stat_key: 'rip_tire_kill', value: 4 }])
  })

  it('reverts one scalar while keeping the others', () => {
    const r = rec(['data.damage', 'data.healing'], { damage: 8500, healing: 2000 })
    const set = withoutField(r, scalarPath('damage'))
    expect(set.damage).toBeUndefined()
    expect(set.healing).toBe(2000)
  })

  it('reverts one stat cell while keeping a scalar', () => {
    const r = rec(
      ['data.damage', 'data.heroes_played.junkrat.stats.rip_tire_kill'],
      { damage: 8500, heroes_played: [{ hero: 'junkrat', stats: { rip_tire_kill: 4 } }] },
    )
    const set = withoutField(r, statPath('junkrat', 'rip_tire_kill'))
    expect(set.hero_stats ?? []).toEqual([])
    expect(set.damage).toBe(8500)
  })

  it('adds a new stat-cell override on top of existing edits', () => {
    const r = rec(['data.damage'], { damage: 8500 })
    const set = withStatEdit(r, 'junkrat', 'charge_kill', 2)
    expect(set.damage).toBe(8500)
    expect(set.hero_stats).toContainEqual({ hero: 'junkrat', stat_key: 'charge_kill', value: 2 })
  })

  it('isEmptyOverrideSet detects a fully-reverted set (but not an explicit 0)', () => {
    expect(isEmptyOverrideSet({})).toBe(true)
    expect(isEmptyOverrideSet({ hero_stats: [] })).toBe(true)
    expect(isEmptyOverrideSet({ damage: 0 })).toBe(false)
    expect(isEmptyOverrideSet({ hero_stats: [{ hero: 'a', stat_key: 'b', value: 1 }] })).toBe(false)
  })

  it('isFieldEdited reflects edited_fields membership', () => {
    const r = rec(['data.damage'], { damage: 8500 })
    expect(isFieldEdited(r, 'data.damage')).toBe(true)
    expect(isFieldEdited(r, 'data.healing')).toBe(false)
  })
})

// A manual match lives ONLY in the override layer — there is no OCR row
// underneath. `edited_fields` is deliberately empty for one (every field is
// the user's, so there is nothing to mark with a revert ✎), which meant the
// reconstruction below came back EMPTY. The store's upsert is a whole-row
// replace by design — a nil scalar IS the per-field revert — so sending
// that empty set plus one edited stat nulled the map, hero, result, date
// and rank of a match with nothing to fall back on.
describe('overrideSetFromRecord — a manual match', () => {
  const manual = {
    match_key: 'manual-1',
    source: 'manual',
    source_files: [],
    edited_fields: [],
    data: {
      map: 'rialto', hero: 'ana', result: 'victory',
      date: '2026-08-18', finished_at: '20:10',
      eliminations: 20, deaths: 4,
      played_at_utc: '2026-08-19T02:10:00Z',
      heroes_played: [{ hero: 'ana', percent_played: 100 }],
    },
  } as unknown as MatchRecord

  it('reconstructs every field it holds, not the empty edited list', () => {
    const set = overrideSetFromRecord(manual)
    expect(set.map).toBe('rialto')
    expect(set.hero).toBe('ana')
    expect(set.result).toBe('victory')
    expect(set.date).toBe('2026-08-18')
    expect(set.finished_at).toBe('20:10')
    expect(set.eliminations).toBe(20)
    expect(set.deaths).toBe(4)
    expect(set.heroes).toEqual([
      { hero: 'ana', percent_played: 100, play_time: undefined, position: 0 },
    ])
  })

  // The instant comes from the wire offset, which the wall clock cannot
  // reproduce — so an omitted one is a lost moment, not a re-derivable one.
  it('carries the exact instant a manual entry was given', () => {
    expect(overrideSetFromRecord(manual).played_at_utc).toBe('2026-08-19T02:10:00Z')
  })

  it('leaves out what the match does not carry, so nothing is invented', () => {
    const set = overrideSetFromRecord(manual)
    expect(set).not.toHaveProperty('damage')
    expect(set).not.toHaveProperty('rank')
  })

  // An OCR match is unchanged: only what was actually edited is an override,
  // because everything else has an OCR value to revert to.
  it('still reads edited_fields for an OCR match', () => {
    const ocr = {
      match_key: 'm-1',
      source: 'ocr_edited',
      source_files: ['m-1.png'],
      edited_fields: ['data.damage'],
      data: { map: 'ilios', damage: 9000 },
    } as unknown as MatchRecord
    const set = overrideSetFromRecord(ocr)
    expect(set.damage).toBe(9000)
    expect(set).not.toHaveProperty('map')
  })
})

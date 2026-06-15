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

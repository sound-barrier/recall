import { describe, it, expect } from 'vitest'

import { disruptionLabel, disruptionTint } from '@/match/dossier/match-disruption'

describe('disruptionTint', () => {
  it('returns null for an untagged match so the badge stays off', () => {
    expect(disruptionTint(undefined)).toBeNull()
    expect(disruptionTint([])).toBeNull()
  })

  it("reads your own side's disruption as 'own'", () => {
    expect(disruptionTint(['self'])).toBe('own')
    expect(disruptionTint(['team'])).toBe('own')
    expect(disruptionTint(['self', 'team'])).toBe('own')
  })

  it("reads an enemy-only disruption as 'enemy'", () => {
    expect(disruptionTint(['enemy'])).toBe('enemy')
  })

  it("reads a both-teams disruption as 'both', not as either side", () => {
    expect(disruptionTint(['team', 'enemy'])).toBe('both')
    expect(disruptionTint(['self', 'enemy'])).toBe('both')
  })
})

describe('disruptionLabel', () => {
  it('names the kind and every side', () => {
    expect(disruptionLabel('leavers', ['team'])).toBe('Leaver: teammate')
    expect(disruptionLabel('throwers', ['enemy'])).toBe('Thrower: enemy')
  })

  it('lists sides in canonical order regardless of input order', () => {
    expect(disruptionLabel('leavers', ['enemy', 'self'])).toBe('Leaver: you, enemy')
    expect(disruptionLabel('leavers', ['self', 'enemy'])).toBe('Leaver: you, enemy')
    expect(disruptionLabel('throwers', ['enemy', 'team', 'self']))
      .toBe('Thrower: you, teammate, enemy')
  })

  it('returns an empty string for no sides so callers can bind it unconditionally', () => {
    expect(disruptionLabel('leavers', [])).toBe('')
    expect(disruptionLabel('throwers', undefined)).toBe('')
  })
})

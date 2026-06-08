import { describe, it, expect } from 'vitest'
import {
  tallyWLD,
  formatToHundredths,
  modeOf,
  avgGameLengthMinutes,
} from './match-stats-helpers'

// ─── tallyWLD ────────────────────────────────────────────────────────
//
// W/L/D rollup. Counted case-insensitively (the parser stores "victory"
// / "defeat" / "draw" but earlier rows have varying casing). Any other
// value (empty, unknown, "in progress") is silently ignored — partial
// rolls always sum to W+L+D ≤ length.

describe('tallyWLD', () => {
  it('counts wins, losses, draws case-insensitively', () => {
    const t = tallyWLD([
      { data: { result: 'victory' } },
      { data: { result: 'VICTORY' } },
      { data: { result: 'defeat' } },
      { data: { result: 'Draw' } },
      { data: { result: 'draw' } },
    ])
    expect(t).toEqual({ w: 2, l: 1, d: 2 })
  })

  it('ignores rows without a result (no inference)', () => {
    const t = tallyWLD([
      { data: { result: 'victory' } },
      { data: {} },
      { data: { result: '' } },
      { data: { result: 'unknown' } },
    ])
    expect(t).toEqual({ w: 1, l: 0, d: 0 })
  })

  it('returns zeros for an empty input', () => {
    expect(tallyWLD([])).toEqual({ w: 0, l: 0, d: 0 })
  })

  it('skips annotated leaver matches when skipAnnotated=true', () => {
    const recs = [
      { data: { result: 'victory' } },
      { data: { result: 'victory' }, annotation: { leaver: 'enemy' } }, // tainted win
      { data: { result: 'defeat' }, annotation: { leaver: 'team' } },   // excused loss
      { data: { result: 'defeat' } },
    ]
    // Default behaviour counts everything.
    expect(tallyWLD(recs)).toEqual({ w: 2, l: 2, d: 0 })
    // With skipAnnotated the two annotated matches drop out.
    expect(tallyWLD(recs, true)).toEqual({ w: 1, l: 1, d: 0 })
  })

  it('a null annotation does not count as annotated for skipAnnotated', () => {
    const recs = [
      { data: { result: 'victory' }, annotation: null },
      { data: { result: 'defeat' }, annotation: { leaver: '' } }, // empty leaver = no annotation
    ]
    expect(tallyWLD(recs, true)).toEqual({ w: 1, l: 1, d: 0 })
  })
})

// ─── formatToHundredths ────────────────────────────────────────────

describe('formatToHundredths', () => {
  it('renders integer inputs with two trailing zeros', () => {
    expect(formatToHundredths(7)).toBe('7.00')
    expect(formatToHundredths(0)).toBe('0.00')
  })

  it('rounds half away from zero past the IEEE 754 boundary', () => {
    // The naive toFixed(2) returns "12.13" because 12.135 is
    // stored as 12.134999…. The epsilon shift corrects to "12.14".
    expect(formatToHundredths(12.135)).toBe('12.14')
    expect(formatToHundredths(5.075)).toBe('5.08')
  })

  it('preserves sub-boundary decimals (no over-correction)', () => {
    expect(formatToHundredths(12.134)).toBe('12.13')
    expect(formatToHundredths(5.073)).toBe('5.07')
  })

  it('rounds genuinely halfway floats upward', () => {
    expect(formatToHundredths(0.005)).toBe('0.01')
    expect(formatToHundredths(0.015)).toBe('0.02')
  })

  it('handles negatives with sign-aware rounding', () => {
    // Sign-aware so −12.135 → −12.14, not −12.13.
    expect(formatToHundredths(-12.135)).toBe('-12.14')
    expect(formatToHundredths(-5.075)).toBe('-5.08')
  })

  it('renders null / undefined / NaN as em-dash', () => {
    expect(formatToHundredths(null)).toBe('—')
    expect(formatToHundredths(undefined)).toBe('—')
    expect(formatToHundredths(NaN)).toBe('—')
    expect(formatToHundredths(Infinity)).toBe('—')
  })
})

// ─── modeOf ────────────────────────────────────────────────────────

describe('modeOf', () => {
  it('returns the most-common value with its count', () => {
    const recs = [
      { hero: 'lucio' },
      { hero: 'lucio' },
      { hero: 'ana' },
    ]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'lucio', count: 2 })
  })

  it('returns null when the record set is empty', () => {
    expect(modeOf([], r => (r as { hero: string }).hero)).toBeNull()
  })

  it('returns null when every picker result is null/undefined/empty', () => {
    expect(modeOf([{ hero: null }, { hero: '' }, { hero: undefined }], r => r.hero)).toBeNull()
  })

  it('ignores null / undefined / empty-string values from the picker', () => {
    const recs = [{ hero: 'lucio' }, { hero: null }, { hero: 'lucio' }, { hero: '' }]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'lucio', count: 2 })
  })

  it('breaks ties alphabetically so the readout is stable across reloads', () => {
    // "ana" and "lucio" both appear twice; "ana" is alphabetically
    // earlier so it wins the tie even though it was seen first.
    const recs = [
      { hero: 'lucio' },
      { hero: 'lucio' },
      { hero: 'ana' },
      { hero: 'ana' },
    ]
    expect(modeOf(recs, r => r.hero)).toEqual({ value: 'ana', count: 2 })
  })
})

// ─── avgGameLengthMinutes ──────────────────────────────────────────

describe('avgGameLengthMinutes', () => {
  it('averages parseable game lengths in fractional minutes', () => {
    const recs = [
      { data: { game_length: '10:00' } },
      { data: { game_length: '12:00' } },
    ]
    expect(avgGameLengthMinutes(recs)).toBe(11)
  })

  it('skips records with missing / unparseable game_length', () => {
    const recs = [
      { data: { game_length: '10:00' } },
      { data: { game_length: null } },
      { data: { game_length: '' } },
      { data: { game_length: 'not a duration' } },
      { data: { game_length: '14:00' } },
    ]
    expect(avgGameLengthMinutes(recs)).toBe(12)
  })

  it('returns null when no record contributes a parseable value', () => {
    expect(avgGameLengthMinutes([])).toBeNull()
    expect(avgGameLengthMinutes([{ data: { game_length: null } }])).toBeNull()
  })

  it('handles records with no data object at all', () => {
    expect(avgGameLengthMinutes([{ data: null }])).toBeNull()
  })
})

import { describe, it, expect } from 'vitest'

import {
  InvalidMatchKeyError,
  isAmbiguousMatchKey,
  isTrackedMatchKey,
  isUnmatchedMatchKey,
  parseMatchKey,
  tryParseMatchKey,
} from '@/match/match-key'

describe('parseMatchKey', () => {
  it.each([
    ['match-2026-05-10T22-21-11', 'tracked', '2026-05-10T22-21-11'],
    ['unmatched-some-file.png', 'unmatched', 'some-file.png'],
    ['ambiguous-other.png', 'ambiguous', 'other.png'],
  ])('parses %s', (input, wantKind, wantBody) => {
    const mk = parseMatchKey(input)
    expect(mk.kind).toBe(wantKind)
    expect(mk.body).toBe(wantBody)
    expect(mk.raw).toBe(input)
  })

  it.each([
    '',
    'matchx-bogus',
    'no-prefix',
    'matchcolon:1234',
  ])('throws InvalidMatchKeyError for %s', (input) => {
    expect(() => parseMatchKey(input)).toThrow(InvalidMatchKeyError)
  })
})

describe('tryParseMatchKey', () => {
  it('returns the typed key on success', () => {
    expect(tryParseMatchKey('ambiguous-x.png')?.kind).toBe('ambiguous')
  })

  it('returns null on unknown prefix', () => {
    expect(tryParseMatchKey('bogus')).toBeNull()
  })
})

describe('kind predicates', () => {
  it('flag the right prefix', () => {
    expect(isAmbiguousMatchKey('ambiguous-x.png')).toBe(true)
    expect(isAmbiguousMatchKey('match-2026-01-01T00-00-00')).toBe(false)
    expect(isUnmatchedMatchKey('unmatched-x.png')).toBe(true)
    expect(isUnmatchedMatchKey('ambiguous-x.png')).toBe(false)
    expect(isTrackedMatchKey('match-2026-01-01T00-00-00')).toBe(true)
    expect(isTrackedMatchKey('unmatched-x.png')).toBe(false)
  })
})

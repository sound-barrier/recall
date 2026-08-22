import { describe, it, expect } from 'vitest'

import { InvalidMatchKeyError, isAmbiguousMatchKey, isReplayMatchKey, isReviewableMatchKey, isTrackedMatchKey, isUnmatchedMatchKey, parseMatchKey, tryParseMatchKey } from '@/match/match-key'

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

describe('the replay kind', () => {
  it('parses a replay key and keeps the code as the body', () => {
    const k = parseMatchKey('replay-A1B2C3')
    expect(k.kind).toBe('replay')
    expect(k.body).toBe('A1B2C3')
    expect(k.raw).toBe('replay-A1B2C3')
  })

  it('classifies each kind as exactly one thing', () => {
    const probes = {
      tracked: isTrackedMatchKey,
      unmatched: isUnmatchedMatchKey,
      ambiguous: isAmbiguousMatchKey,
      replay: isReplayMatchKey,
    } as const
    const samples = {
      tracked: 'match-2026-01-01T00-00-00',
      unmatched: 'unmatched-abc',
      ambiguous: 'ambiguous-abc',
      replay: 'replay-A1B2C3',
    } as const
    for (const [kind, key] of Object.entries(samples)) {
      for (const [probeName, probe] of Object.entries(probes)) {
        expect(probe(key)).toBe(probeName === kind)
      }
    }
  })

  // A note can be written about a tracked match or a replay match, and about
  // nothing else. The reel and the hand-off button both gate on this: get it
  // wrong and a code-only session renders an empty desk.
  it('admits tracked and replay keys as reviewable, and no others', () => {
    expect(isReviewableMatchKey('match-2026-01-01T00-00-00')).toBe(true)
    expect(isReviewableMatchKey('replay-A1B2C3')).toBe(true)
    expect(isReviewableMatchKey('unmatched-abc')).toBe(false)
    expect(isReviewableMatchKey('ambiguous-abc')).toBe(false)
  })
})

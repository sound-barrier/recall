import { describe, it, expect } from 'vitest'

import { scoreMatch } from '@/match/palette-score'

describe('scoreMatch', () => {
  // The reason this is a subsequence matcher and not a substring one: typing
  // initials is the whole value of a palette.
  it('matches non-contiguous initials', () => {
    expect(scoreMatch('wbh', 'Win-rate by hero')).not.toBeNull()
    expect(scoreMatch('wbh', 'Win-rate by hero')!.hits).toHaveLength(3)
  })

  it('returns null when the letters are not in order', () => {
    expect(scoreMatch('hbw', 'Win-rate by hero')).toBeNull()
  })

  it('returns null on a letter that is absent', () => {
    expect(scoreMatch('wbz', 'Win-rate by hero')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(scoreMatch('ANA', 'ana')).not.toBeNull()
  })

  // An empty query shows the corpus rather than hiding it, so the palette is
  // browsable before it is searchable.
  it('matches everything on an empty query', () => {
    expect(scoreMatch('', 'anything')).toEqual({ score: 0, hits: [] })
  })

  it('ranks a contiguous match above a scattered one', () => {
    const tight = scoreMatch('hero', 'hero pool')!
    const loose = scoreMatch('hero', 'here is one rocket')!

    expect(tight.score).toBeGreaterThan(loose.score)
  })

  it('ranks a word-boundary match above a mid-word one', () => {
    const boundary = scoreMatch('map', 'Win-rate by map')!
    const midword = scoreMatch('map', 'Unmapped screenshots')!

    expect(boundary.score).toBeGreaterThan(midword.score)
  })

  // "ana" should find the hero, not a settings section that happens to contain
  // the letters.
  it('ranks a short label above a long one on an equal match', () => {
    const short = scoreMatch('ana', 'Ana')!
    const long = scoreMatch('ana', 'Ana — analysis and diagnostics settings')!

    expect(short.score).toBeGreaterThan(long.score)
  })

  it('reports the matched positions so the UI can show the shape of the match', () => {
    const got = scoreMatch('by', 'Win-rate by map')!

    expect(got.hits.map((i) => 'Win-rate by map'[i]).join('')).toBe('by')
  })
})

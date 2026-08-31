import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api-client'
import { railTendencies, RAIL_LOW_SAMPLE } from '@/match/coach/coach-rail-helpers'

interface RecOpts {
  hero?: string
  map?: string
  result?: string
  elims?: number
  assists?: number
  deaths?: number
}

function rec(over: RecOpts = {}): MatchRecord {
  const { hero = 'ana', map = 'rialto', result = 'victory', ...stats } = over
  return {
    match_key: `m-${hero}-${map}-${result}-${Math.random()}`,
    source_files: ['a.png'],
    data: { hero, map, result, ...eadFields(stats) },
  } as unknown as MatchRecord
}

// Only the readings a case actually supplies. A match with no E/A/D is a
// screenshot Recall could not read, not a game with zero eliminations —
// and the difference is exactly what one of these tests is about.
function eadFields(s: Pick<RecOpts, 'elims' | 'assists' | 'deaths'>) {
  return {
    ...(s.elims === undefined ? {} : { eliminations: s.elims }),
    ...(s.assists === undefined ? {} : { assists: s.assists }),
    ...(s.deaths === undefined ? {} : { deaths: s.deaths }),
  }
}

// The rail answers ONE question, twice: what does this player usually do on
// this hero, and on this map. A coach mid-frame should not have to leave the
// room to find out — the corpus is already loaned and already on screen.
describe('railTendencies', () => {
  it('splits the corpus by the frame’s own hero and map', () => {
    const corpus = [
      rec({ hero: 'ana', map: 'rialto', result: 'victory' }),
      rec({ hero: 'ana', map: 'hanaoka', result: 'defeat' }),
      rec({ hero: 'juno', map: 'rialto', result: 'defeat' }),
    ]
    const rows = railTendencies(corpus, { hero: 'ana', map: 'rialto' })

    expect(rows.map((r) => r.key)).toEqual(['ana', 'rialto'])
    // Ana: one win, one loss across two maps.
    expect(rows[0]).toMatchObject({ w: 1, l: 1, winrate: 50 })
    // Rialto: one win, one loss across two heroes.
    expect(rows[1]).toMatchObject({ w: 1, l: 1, winrate: 50 })
  })

  // Draws are not losses — the house convention, and the same one the
  // headline winrate uses.
  it('leaves draws out of the rate but counts them as played', () => {
    const rows = railTendencies([
      rec({ result: 'victory' }),
      rec({ result: 'draw' }),
    ], { hero: 'ana', map: 'rialto' })
    expect(rows[0]).toMatchObject({ w: 1, l: 0, winrate: 100, played: 2 })
  })

  it('reports no rate at all when nothing was decided', () => {
    const rows = railTendencies([rec({ result: 'draw' })], { hero: 'ana', map: 'rialto' })
    expect(rows[0]?.winrate).toBeNull()
  })

  // Raw per-match E/A/D, averaged. NOT performance.*.avg_per_10min — that is
  // a different scale, and mixing the two silently produces a number that
  // means nothing.
  it('averages raw per-match E/A/D over the matches that carry one', () => {
    const rows = railTendencies([
      rec({ elims: 20, assists: 10, deaths: 8 }),
      rec({ elims: 10, assists: 4, deaths: 2 }),
      rec({}), // no readings — must not drag the average toward zero
    ], { hero: 'ana', map: 'rialto' })
    expect(rows[0]).toMatchObject({ elims: 15, assists: 7, deaths: 5, statSample: 2 })
  })

  it('has no E/A/D to report when no match carries a reading', () => {
    const rows = railTendencies([rec({})], { hero: 'ana', map: 'rialto' })
    expect(rows[0]).toMatchObject({ elims: null, assists: null, deaths: null, statSample: 0 })
  })

  // A bundle is six matches. Buckets of one are the norm, not the exception,
  // so the rail says so rather than presenting 100% as a tendency.
  it('flags a bucket too small to be a tendency', () => {
    const rows = railTendencies([rec({ result: 'victory' })], { hero: 'ana', map: 'rialto' })
    expect(rows[0]?.lowSample).toBe(true)

    const many = Array.from({ length: RAIL_LOW_SAMPLE }, () => rec({ result: 'victory' }))
    expect(railTendencies(many, { hero: 'ana', map: 'rialto' })[0]?.lowSample).toBe(false)
  })

  // A frame with no hero or no map read has no tendency to show, and an
  // empty-keyed bucket would silently pool every unread match together.
  it('omits a dimension the frame cannot name', () => {
    const rows = railTendencies([rec({})], { hero: '', map: 'rialto' })
    expect(rows.map((r) => r.key)).toEqual(['rialto'])
  })

  it('is empty when the frame names neither', () => {
    expect(railTendencies([rec({})], { hero: '', map: '' })).toEqual([])
  })
})

import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '../api'
import { useTableSort, type TableSortCol } from './useTableSort'

interface RecOpts {
  map?: string
  playlist?: string
  hero?: string
  role?: string
  result?: string
  elims?: number
  tags?: string[]
  parsedAt?: string
  date?: string
  finishedAt?: string
  heroesPlayed?: { hero: string; percent_played?: number }[]
}

function rec(key: string, o: RecOpts = {}): MatchRecord {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: o.map ?? 'rialto',
      playlist: o.playlist ?? 'competitive',
      hero: o.hero ?? 'lucio',
      role: o.role ?? 'support',
      result: o.result ?? 'victory',
      eliminations: o.elims ?? 10,
      ...(o.date ? { date: o.date } : {}),
      ...(o.finishedAt ? { finished_at: o.finishedAt } : {}),
      ...(o.heroesPlayed ? { heroes_played: o.heroesPlayed } : {}),
    },
    parsed_at: o.parsedAt ?? '2026-05-10T20:00:00Z',
    ...(o.tags ? { annotation: { tags: o.tags } } : {}),
  } as unknown as MatchRecord
}

function keysAfterSort(records: MatchRecord[], col: TableSortCol, clicks = 1): string[] {
  const { cycleSort, sortRows } = useTableSort()
  for (let i = 0; i < clicks; i++) cycleSort(col)
  return sortRows(records).map((r) => r.match_key)
}

describe('useTableSort', () => {
  it('defaults to date-descending (newest first), matching the leaf list', () => {
    const { sortCol, sortDir, sortRows } = useTableSort()
    expect(sortCol.value).toBe('date')
    expect(sortDir.value).toBe('desc')
    const out = sortRows([
      rec('old', { parsedAt: '2026-05-01T10:00:00Z' }),
      rec('new', { parsedAt: '2026-05-09T10:00:00Z' }),
    ])
    expect(out.map((r) => r.match_key)).toEqual(['new', 'old'])
  })

  it('sorts the When column by MATCH time (data.date + finished_at), not parsed_at', () => {
    // Ingested together (same parsed_at), but played in different
    // years. The When sort must order by when they were PLAYED.
    const corpus = [
      rec('dec', { date: '2025-12-31', finishedAt: '20:00', parsedAt: '2026-06-10T09:00:00Z' }),
      rec('jun', { date: '2026-06-03', finishedAt: '20:00', parsedAt: '2026-06-10T09:00:00Z' }),
    ]
    const { sortRows } = useTableSort() // default: date desc (newest match first)
    expect(sortRows(corpus).map((r) => r.match_key)).toEqual(['jun', 'dec'])
  })

  it('sorts the Hero column by the MOST-PLAYED hero, not the primary', () => {
    const corpus = [
      // primary data.hero is 'lucio', but Ana was played 70% of the match
      rec('ana-main', { hero: 'lucio', heroesPlayed: [{ hero: 'ana', percent_played: 70 }, { hero: 'lucio', percent_played: 30 }] }),
      rec('zen', { hero: 'zenyatta', heroesPlayed: [{ hero: 'zenyatta', percent_played: 100 }] }),
    ]
    // Ascending by most-played: 'ana' < 'zenyatta'.
    expect(keysAfterSort(corpus, 'hero', 1)).toEqual(['ana-main', 'zen'])
  })

  it('sorts a text column (map) ascending, then descending on a second click', () => {
    const corpus = [
      rec('rialto', { map: 'rialto' }),
      rec('busan', { map: 'busan' }),
      rec('ilios', { map: 'ilios' }),
    ]
    expect(keysAfterSort(corpus, 'map', 1)).toEqual(['busan', 'ilios', 'rialto'])
    expect(keysAfterSort(corpus, 'map', 2)).toEqual(['rialto', 'ilios', 'busan'])
  })

  it('sorts a numeric column (eliminations) numerically, not lexically', () => {
    const corpus = [
      rec('a', { elims: 9 }),
      rec('b', { elims: 100 }),
      rec('c', { elims: 20 }),
    ]
    // Lexical would put '100' before '20'; numeric keeps 9 < 20 < 100.
    expect(keysAfterSort(corpus, 'eliminations', 1)).toEqual(['a', 'c', 'b'])
  })

  it('sorts the remaining text columns (mode, hero, role) alphabetically', () => {
    const byMode = [
      rec('quick', { playlist: 'quickplay' }),
      rec('arcade', { playlist: 'arcade' }),
      rec('comp', { playlist: 'competitive' }),
    ]
    expect(keysAfterSort(byMode, 'mode', 1)).toEqual(['arcade', 'comp', 'quick'])

    const byHero = [
      rec('z', { hero: 'zarya' }),
      rec('a', { hero: 'ana' }),
      rec('m', { hero: 'mercy' }),
    ]
    expect(keysAfterSort(byHero, 'hero', 1)).toEqual(['a', 'm', 'z'])

    const byRole = [
      rec('t', { role: 'tank' }),
      rec('d', { role: 'damage' }),
      rec('s', { role: 'support' }),
    ]
    expect(keysAfterSort(byRole, 'role', 1)).toEqual(['d', 's', 't'])
  })

  it('ranks results victory → draw → defeat when ascending', () => {
    const corpus = [
      rec('loss', { result: 'defeat' }),
      rec('win', { result: 'victory' }),
      rec('tie', { result: 'draw' }),
    ]
    expect(keysAfterSort(corpus, 'result', 1)).toEqual(['win', 'tie', 'loss'])
  })

  it('sorts the tags column by the first tag', () => {
    const corpus = [
      rec('z', { tags: ['zone'] }),
      rec('a', { tags: ['ace'] }),
      rec('none', {}),
    ]
    // Empty (no tags) sorts before populated under localeCompare of ''.
    expect(keysAfterSort(corpus, 'tags', 1)).toEqual(['none', 'a', 'z'])
  })

  it('clicking a new column resets direction to ascending', () => {
    const { sortCol, sortDir, cycleSort } = useTableSort()
    cycleSort('map') // map asc
    expect([sortCol.value, sortDir.value]).toEqual(['map', 'asc'])
    cycleSort('map') // map desc
    expect(sortDir.value).toBe('desc')
    cycleSort('hero') // switch column → back to asc
    expect([sortCol.value, sortDir.value]).toEqual(['hero', 'asc'])
  })

  it('breaks ties by newest-first regardless of sort direction', () => {
    const corpus = [
      rec('older', { map: 'rialto', parsedAt: '2026-05-01T10:00:00Z' }),
      rec('newer', { map: 'rialto', parsedAt: '2026-05-09T10:00:00Z' }),
    ]
    // Same map → tie → newest (newer) first whether asc or desc.
    expect(keysAfterSort(corpus, 'map', 1)).toEqual(['newer', 'older'])
    expect(keysAfterSort(corpus, 'map', 2)).toEqual(['newer', 'older'])
  })

  it('exposes aria-sort only for the active column', () => {
    const { cycleSort, ariaSort } = useTableSort()
    cycleSort('map')
    expect(ariaSort('map')).toBe('ascending')
    expect(ariaSort('hero')).toBe('none')
    cycleSort('map')
    expect(ariaSort('map')).toBe('descending')
  })

  it('does not mutate the input array', () => {
    const { sortRows } = useTableSort()
    const corpus = [rec('b', { map: 'busan' }), rec('a', { map: 'ashe' })]
    const before = corpus.map((r) => r.match_key)
    sortRows(corpus)
    expect(corpus.map((r) => r.match_key)).toEqual(before)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import type { MatchRecord } from '@/api'
import { useTableSort, type TableSortCol } from '@/composables/matches/useTableSort'

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
  source?: 'ocr' | 'ocr_edited' | 'manual'
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
    ...(o.source ? { source: o.source } : {}),
  } as unknown as MatchRecord
}

// Mount the composable inside a throwaway component so usePersistedRef's
// lifecycle hooks (onMounted / onBeforeUnmount) bind to a real instance.
function mountSort() {
  let api!: ReturnType<typeof useTableSort>
  mount(defineComponent({
    setup() {
      api = useTableSort()
      return () => h('div')
    },
  }))
  return api
}

// A fresh interaction: wipe the persisted stack, then apply `clicks`
// plain header clicks on one column. Each call is independent of any
// stack a previous call may have persisted.
function keysAfterSort(records: MatchRecord[], col: TableSortCol, clicks = 1): string[] {
  localStorage.clear()
  const api = mountSort()
  for (let i = 0; i < clicks; i++) api.cycleSort(col)
  return api.sortRows(records).map((r) => r.match_key)
}

// happy-dom doesn't expose a global localStorage; stub an in-memory one
// (mirrors usePersistedRef.test.ts) so the persisted stack round-trips.
let storage: Record<string, string>
beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('useTableSort — single level (default + per-column)', () => {
  it('defaults to a single date-descending key (newest first)', () => {
    const api = mountSort()
    expect(api.sortKeys.value).toEqual([{ col: 'date', dir: 'desc' }])
    const out = api.sortRows([
      rec('old', { parsedAt: '2026-05-01T10:00:00Z' }),
      rec('new', { parsedAt: '2026-05-09T10:00:00Z' }),
    ])
    expect(out.map((r) => r.match_key)).toEqual(['new', 'old'])
  })

  it('sorts the When column by MATCH time (data.date + finished_at), not parsed_at', () => {
    const corpus = [
      rec('dec', { date: '2025-12-31', finishedAt: '20:00', parsedAt: '2026-06-10T09:00:00Z' }),
      rec('jun', { date: '2026-06-03', finishedAt: '20:00', parsedAt: '2026-06-10T09:00:00Z' }),
    ]
    const api = mountSort() // default: date desc (newest match first)
    expect(api.sortRows(corpus).map((r) => r.match_key)).toEqual(['jun', 'dec'])
  })

  it('sorts the Hero column by the MOST-PLAYED hero, not the primary', () => {
    const corpus = [
      rec('ana-main', { hero: 'lucio', heroesPlayed: [{ hero: 'ana', percent_played: 70 }, { hero: 'lucio', percent_played: 30 }] }),
      rec('zen', { hero: 'zenyatta', heroesPlayed: [{ hero: 'zenyatta', percent_played: 100 }] }),
    ]
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
    expect(keysAfterSort(corpus, 'eliminations', 1)).toEqual(['a', 'c', 'b'])
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
    expect(keysAfterSort(corpus, 'tags', 1)).toEqual(['none', 'a', 'z'])
  })

  it('sorts the edited column with untouched rows first ascending', () => {
    const corpus = [
      rec('edited', { source: 'ocr_edited' }),
      rec('ocr', {}),
      rec('manual', { source: 'manual' }),
    ]
    // Only the ocr_edited row ticks the Edited box; OCR + manual are
    // both "not edited" (false) and sort ahead of it ascending. The
    // two false rows tie on the column, so newest-first breaks it —
    // here both share the default parsed_at, so insertion order holds.
    expect(keysAfterSort(corpus, 'edited', 1)).toEqual(['ocr', 'manual', 'edited'])
  })

  it('sorts the manual column with non-manual rows first ascending', () => {
    const corpus = [
      rec('manual', { source: 'manual' }),
      rec('ocr', {}),
      rec('edited', { source: 'ocr_edited' }),
    ]
    expect(keysAfterSort(corpus, 'manual', 1)).toEqual(['ocr', 'edited', 'manual'])
  })

  it('breaks ties by newest-first regardless of sort direction', () => {
    const corpus = [
      rec('older', { map: 'rialto', parsedAt: '2026-05-01T10:00:00Z' }),
      rec('newer', { map: 'rialto', parsedAt: '2026-05-09T10:00:00Z' }),
    ]
    expect(keysAfterSort(corpus, 'map', 1)).toEqual(['newer', 'older'])
    expect(keysAfterSort(corpus, 'map', 2)).toEqual(['newer', 'older'])
  })

  it('does not mutate the input array', () => {
    const api = mountSort()
    const corpus = [rec('b', { map: 'busan' }), rec('a', { map: 'ashe' })]
    const before = corpus.map((r) => r.match_key)
    api.sortRows(corpus)
    expect(corpus.map((r) => r.match_key)).toEqual(before)
  })
})

describe('useTableSort — multi-level (Excel-style)', () => {
  // Primary ties on map; the secondary key on eliminations decides.
  const TIED = [
    rec('busan-30', { map: 'busan', elims: 30 }),
    rec('busan-10', { map: 'busan', elims: 10 }),
    rec('ashe-20', { map: 'ashe', elims: 20 }),
  ]

  it('shift-clicking a second column appends it as a secondary key', () => {
    const api = mountSort()
    api.cycleSort('map') // plain → [map asc]
    api.cycleSort('eliminations', { append: true }) // shift → [map asc, elims asc]
    expect(api.sortKeys.value).toEqual([
      { col: 'map', dir: 'asc' },
      { col: 'eliminations', dir: 'asc' },
    ])
  })

  it('a secondary key breaks ties left by the primary', () => {
    const api = mountSort()
    api.cycleSort('map') // [map asc]
    api.cycleSort('eliminations', { append: true }) // [map asc, elims asc]
    // ashe first; within busan, elims asc → 10 before 30.
    expect(api.sortRows(TIED).map((r) => r.match_key)).toEqual(['ashe-20', 'busan-10', 'busan-30'])
  })

  it('a descending secondary reverses only the tie-break group', () => {
    const api = mountSort()
    api.cycleSort('map') // [map asc]
    api.cycleSort('eliminations', { append: true }) // [map asc, elims asc]
    api.cycleSort('eliminations', { append: true }) // re-shift → flip secondary → [map asc, elims desc]
    expect(api.sortRows(TIED).map((r) => r.match_key)).toEqual(['ashe-20', 'busan-30', 'busan-10'])
  })

  it('shift-clicking a column already in the stack toggles its direction in place (never removes)', () => {
    const api = mountSort()
    api.cycleSort('map') // [map asc]
    api.cycleSort('result', { append: true }) // [map asc, result asc]
    api.cycleSort('map', { append: true }) // flip primary in place, keep secondary
    expect(api.sortKeys.value).toEqual([
      { col: 'map', dir: 'desc' },
      { col: 'result', dir: 'asc' },
    ])
  })

  it('shift-clicking the same column never adds a duplicate level', () => {
    const api = mountSort()
    api.cycleSort('map')
    api.cycleSort('map', { append: true })
    expect(api.sortKeys.value).toEqual([{ col: 'map', dir: 'desc' }])
  })

  it('a plain click on a non-primary column collapses to a single key', () => {
    const api = mountSort()
    api.cycleSort('map') // [map asc]
    api.cycleSort('result', { append: true }) // [map asc, result asc]
    api.cycleSort('hero') // plain → resets the whole stack
    expect(api.sortKeys.value).toEqual([{ col: 'hero', dir: 'asc' }])
  })

  it('a plain click on the primary column flips it and drops secondaries', () => {
    const api = mountSort()
    api.cycleSort('map') // [map asc]
    api.cycleSort('result', { append: true }) // [map asc, result asc]
    api.cycleSort('map') // plain on primary → flip + drop secondaries
    expect(api.sortKeys.value).toEqual([{ col: 'map', dir: 'desc' }])
  })

  it('sortLevelOf reports 1-based positions, 0 when absent', () => {
    const api = mountSort()
    api.cycleSort('map')
    api.cycleSort('result', { append: true })
    expect(api.sortLevelOf('map')).toBe(1)
    expect(api.sortLevelOf('result')).toBe(2)
    expect(api.sortLevelOf('hero')).toBe(0)
  })

  it('ariaSort reflects every sorted column’s direction', () => {
    const api = mountSort()
    api.cycleSort('map')
    api.cycleSort('result', { append: true })
    expect(api.ariaSort('map')).toBe('ascending')
    expect(api.ariaSort('result')).toBe('ascending')
    expect(api.ariaSort('hero')).toBe('none')
  })
})

describe('useTableSort — dialog mutators', () => {
  it('addLevel appends a column ascending and dedups', () => {
    const api = mountSort() // [date desc]
    api.addLevel('map')
    expect(api.sortKeys.value).toEqual([{ col: 'date', dir: 'desc' }, { col: 'map', dir: 'asc' }])
    api.addLevel('map') // already present → no-op
    expect(api.sortKeys.value).toHaveLength(2)
  })

  it('setLevelDir changes one level’s direction', () => {
    const api = mountSort()
    api.addLevel('map')
    api.setLevelDir('map', 'desc')
    expect(api.sortKeys.value[1]).toEqual({ col: 'map', dir: 'desc' })
  })

  it('setLevelColumn swaps a level’s column, keeping its position + direction', () => {
    const api = mountSort() // [date desc]
    api.addLevel('map') // [date desc, map asc]
    api.setLevelDir('map', 'desc') // [date desc, map desc]
    api.setLevelColumn('map', 'hero') // keep position 2 + desc, just change column
    expect(api.sortKeys.value).toEqual([
      { col: 'date', dir: 'desc' },
      { col: 'hero', dir: 'desc' },
    ])
  })

  it('setLevelColumn is a no-op when the target column is already in the stack', () => {
    const api = mountSort()
    api.addLevel('map') // [date desc, map asc]
    api.setLevelColumn('map', 'date') // 'date' already a level → ignored
    expect(api.sortKeys.value).toEqual([
      { col: 'date', dir: 'desc' },
      { col: 'map', dir: 'asc' },
    ])
  })

  it('moveLevel reorders and clamps at the ends', () => {
    const api = mountSort()
    api.addLevel('map') // [date, map]
    api.moveLevel('map', -1) // swap up → [map, date]
    expect(api.sortKeys.value.map((l) => l.col)).toEqual(['map', 'date'])
    api.moveLevel('map', -1) // already first → no change
    expect(api.sortKeys.value.map((l) => l.col)).toEqual(['map', 'date'])
  })

  it('removeLevel drops a level; clearSort restores the date-desc default', () => {
    const api = mountSort()
    api.addLevel('map')
    api.removeLevel('date')
    expect(api.sortKeys.value).toEqual([{ col: 'map', dir: 'asc' }])
    api.clearSort()
    expect(api.sortKeys.value).toEqual([{ col: 'date', dir: 'desc' }])
  })
})

describe('useTableSort — persistence', () => {
  it('persists the stack across instances (localStorage round-trip)', () => {
    const a = mountSort()
    a.cycleSort('map')
    a.cycleSort('result', { append: true })
    const b = mountSort() // a fresh instance hydrates from localStorage
    expect(b.sortKeys.value).toEqual([
      { col: 'map', dir: 'asc' },
      { col: 'result', dir: 'asc' },
    ])
  })

  it('ignores a corrupt persisted value and falls back to the default', () => {
    localStorage.setItem('recall.matchesTableSort', '[{"col":"not-a-column","dir":"asc"}]')
    const api = mountSort()
    expect(api.sortKeys.value).toEqual([{ col: 'date', dir: 'desc' }])
  })
})

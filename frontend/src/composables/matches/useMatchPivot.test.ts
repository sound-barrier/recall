import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { render } from '@testing-library/vue'

import type { MatchRecord } from '@/api'
import { aggOptionsFor, useMatchPivot } from '@/composables/matches/useMatchPivot'

const STORAGE_KEY = 'recall.matchesPivotConfig'
const DEFAULT_CONFIG = {
  rows: ['hero'],
  columns: ['result'],
  values: [{ field: 'matches', agg: 'count' }, { field: 'matches', agg: 'winRate' }],
  filters: [],
}

function rec(data: Partial<MatchRecord['data']> = {}): MatchRecord {
  return { match_key: `m-${Math.random()}`, source_files: [], data: { ...data } } as unknown as MatchRecord
}

function mountPivot(records: Ref<MatchRecord[]>) {
  let api!: ReturnType<typeof useMatchPivot>
  render(defineComponent({
    setup() {
      api = useMatchPivot(records, () => 'support')
      return () => h('div')
    },
  }))
  return api
}

let storage: Record<string, string>
beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
    clear: () => { storage = {} },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('useMatchPivot — default + crosstab', () => {
  it('starts on a hero × result / count + win-rate pivot', () => {
    const api = mountPivot(ref([]))
    expect(api.config.value.rows).toEqual(['hero'])
    expect(api.config.value.columns).toEqual(['result'])
    expect(api.config.value.values).toEqual([
      { field: 'matches', agg: 'count' },
      { field: 'matches', agg: 'winRate' },
    ])
  })

  it('re-pivots reactively as records and config change', () => {
    const records = ref([rec({ hero: 'ana', result: 'victory' }), rec({ hero: 'ana', result: 'defeat' })])
    const api = mountPivot(records)
    expect(api.result.value.rowKeys).toEqual([['ana']])
    expect(api.result.value.grandTotals[0]).toBe(2) // count
    records.value = [...records.value, rec({ hero: 'dva', result: 'victory' })]
    expect(api.result.value.rowKeys).toEqual([['ana'], ['dva']])
    expect(api.result.value.grandTotals[0]).toBe(3)
  })
})

describe('useMatchPivot — shelf mutators', () => {
  it('moves a dimension to a shelf, leaving the one it came from', () => {
    const api = mountPivot(ref([]))
    api.assignField('hero', 'columns') // hero leaves rows, joins columns
    expect(api.config.value.rows).toEqual([])
    expect(api.config.value.columns).toEqual(['result', 'hero'])
  })

  it('rejects a measure on a dimension shelf and a dimension on values', () => {
    const api = mountPivot(ref([]))
    api.assignField('eliminations', 'rows') // measure → rows: rejected
    expect(api.config.value.rows).toEqual(['hero'])
    api.assignField('map', 'values') // dimension → values: rejected
    expect(api.config.value.values.some((v) => v.field === 'map')).toBe(false)
  })

  it('appends a measure as a value spec with its default aggregation', () => {
    const api = mountPivot(ref([]))
    api.assignField('damage', 'values')
    expect(api.config.value.values.at(-1)).toEqual({ field: 'damage', agg: 'sum' })
  })

  it('offers each measure its own aggregation menu and lands on its default', () => {
    const api = mountPivot(ref([]))
    // The synthetic `matches` field rates the rows; a real measure folds
    // its samples. The chip menu is built straight off these lists.
    expect(aggOptionsFor('matches')).toEqual(['count', 'winRate', 'kd'])
    expect(aggOptionsFor('damage')).toEqual(['sum', 'avg', 'min', 'max'])
    api.assignField('matches', 'values')
    api.assignField('damage', 'values')
    expect(api.config.value.values.slice(-2)).toEqual([
      { field: 'matches', agg: 'count' },
      { field: 'damage', agg: 'sum' },
    ])
  })

  // A drag can aim any chip at any shelf, so the caller needs to know
  // whether the shelf rules accepted it before announcing the move.
  it('reports whether an assignment applied', () => {
    const api = mountPivot(ref([]))
    expect(api.assignField('map', 'rows')).toBe(true)
    expect(api.assignField('damage', 'rows')).toBe(false) // measure on a dimension shelf
    expect(api.assignField('map', 'values')).toBe(false) // dimension on the value shelf
    expect(api.assignField('not-a-field', 'rows')).toBe(false)
    expect(api.config.value.rows).toEqual(['hero', 'map'])
  })

  it('allows the same measure twice with different aggregations', () => {
    const api = mountPivot(ref([]))
    api.assignField('eliminations', 'values') // sum
    api.setValueAgg(api.config.value.values.length - 1, 'avg')
    api.assignField('eliminations', 'values') // sum again
    const elimSpecs = api.config.value.values.filter((v) => v.field === 'eliminations')
    expect(elimSpecs).toEqual([{ field: 'eliminations', agg: 'avg' }, { field: 'eliminations', agg: 'sum' }])
  })

  it('cycles a value spec through its aggregation options by index', () => {
    const api = mountPivot(ref([]))
    // values[0] is matches/count; options are count → winRate → kd → count.
    api.cycleValueAgg(0)
    expect(api.config.value.values[0]?.agg).toBe('winRate')
  })

  it('removes a dimension from every shelf and a value spec by index', () => {
    const api = mountPivot(ref([]))
    api.removeField('hero')
    expect(api.config.value.rows).toEqual([])
    api.removeValue(0) // drop matches/count, leaving matches/winRate
    expect(api.config.value.values).toEqual([{ field: 'matches', agg: 'winRate' }])
  })

  it('keeps measures in the tray but drops placed dimensions', () => {
    const api = mountPivot(ref([]))
    const trayIds = () => api.unusedFields.value.map((f) => f.id)
    expect(trayIds()).not.toContain('hero') // hero is on rows
    expect(trayIds()).toContain('eliminations') // measures always available
    api.assignField('map', 'rows')
    expect(trayIds()).not.toContain('map')
  })

  it('resetPivot restores the default configuration', () => {
    const api = mountPivot(ref([]))
    api.removeField('hero')
    api.resetPivot()
    expect(api.config.value.rows).toEqual(['hero'])
  })
})

describe('useMatchPivot — shelf order', () => {
  it('holds the order at both ends of a shelf and swaps in between', () => {
    const api = mountPivot(ref([]))
    api.assignField('map', 'rows') // rows: hero, map
    api.moveField('hero', 'rows', -1) // already outermost
    expect(api.config.value.rows).toEqual(['hero', 'map'])
    api.moveField('map', 'rows', 1) // already innermost
    expect(api.config.value.rows).toEqual(['hero', 'map'])
    api.moveField('map', 'rows', -1)
    expect(api.config.value.rows).toEqual(['map', 'hero'])
  })

  it('ignores a move for a field that is not on the shelf', () => {
    const api = mountPivot(ref([]))
    api.moveField('map', 'rows', -1)
    expect(api.config.value.rows).toEqual(['hero'])
  })

  it('leaves the filters shelf unordered', () => {
    const api = mountPivot(ref([]))
    api.assignField('map', 'filters')
    api.assignField('rank', 'filters')
    api.moveField('rank', 'filters', -1)
    // Filters slice the set; nesting order is meaningless there.
    expect(api.config.value.filters.map((f) => f.field)).toEqual(['map', 'rank'])
  })

  it('reorders value specs and ignores an index with no spec', () => {
    const api = mountPivot(ref([]))
    api.moveValue(1, -1)
    expect(api.config.value.values).toEqual([
      { field: 'matches', agg: 'winRate' },
      { field: 'matches', agg: 'count' },
    ])
    api.moveValue(9, 1)
    api.cycleValueAgg(9)
    expect(api.config.value.values).toEqual([
      { field: 'matches', agg: 'winRate' },
      { field: 'matches', agg: 'count' },
    ])
  })
})

describe('useMatchPivot — filter values', () => {
  it('scopes an allow-list to the named filter and slices the crosstab by it', () => {
    const records = ref([
      rec({ hero: 'ana', map: 'busan', result: 'victory' }),
      rec({ hero: 'ana', map: 'rialto', result: 'defeat' }),
    ])
    const api = mountPivot(records)
    api.assignField('map', 'filters')
    api.assignField('rank', 'filters')
    api.setFilterAllowed('map', ['busan'])

    expect(api.config.value.filters).toEqual([
      { field: 'map', allowed: ['busan'] },
      { field: 'rank', allowed: [] }, // untouched — the sibling filter is scoped out
    ])
    expect(api.result.value.recordCount).toBe(1)
    // An empty allow-list is "no constraint", so clearing restores the set.
    api.setFilterAllowed('map', [])
    expect(api.result.value.recordCount).toBe(2)
  })
})

describe('useMatchPivot — persistence', () => {
  it('persists config across instances', () => {
    const a = mountPivot(ref([]))
    a.assignField('map', 'rows')
    const b = mountPivot(ref([]))
    expect(b.config.value.rows).toEqual(['hero', 'map'])
  })

  it('adopts a valid persisted config, filters and value specs included', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      rows: ['map'],
      columns: [],
      values: [{ field: 'damage', agg: 'avg' }],
      filters: [{ field: 'result', allowed: ['victory'] }],
    }))
    const api = mountPivot(ref([]))
    expect(api.config.value).toEqual({
      rows: ['map'],
      columns: [],
      values: [{ field: 'damage', agg: 'avg' }],
      filters: [{ field: 'result', allowed: ['victory'] }],
    })
  })

  // The config round-trips through localStorage as bare ids, so anything
  // stale, hand-edited or written by an older build has to fail the guard
  // rather than reach the engine and blank the view.
  it.each([
    ['a payload that is not JSON', 'nonsense{'],
    ['a JSON value that is not an object', '"hero"'],
    ['an unknown dimension id', '{"rows":["not-a-field"],"columns":[],"values":[],"filters":[]}'],
    ['a measure id on a dimension shelf', '{"rows":["damage"],"columns":[],"values":[],"filters":[]}'],
    ['a values list that is not an array', '{"rows":[],"columns":[],"values":{},"filters":[]}'],
    ['a value spec naming an unknown measure', '{"rows":[],"columns":[],"values":[{"field":"map","agg":"sum"}],"filters":[]}'],
    ['a value spec with an unknown aggregation', '{"rows":[],"columns":[],"values":[{"field":"damage","agg":"median"}],"filters":[]}'],
    ['a value spec that is not an object', '{"rows":[],"columns":[],"values":[7],"filters":[]}'],
    ['a filters list that is not an array', '{"rows":[],"columns":[],"values":[],"filters":"none"}'],
    ['a filter naming an unknown dimension', '{"rows":[],"columns":[],"values":[],"filters":[{"field":"nope","allowed":[]}]}'],
    ['a filter whose allow-list holds non-strings', '{"rows":[],"columns":[],"values":[],"filters":[{"field":"map","allowed":[1]}]}'],
  ])('falls back to the default config on %s', (_label, raw) => {
    localStorage.setItem(STORAGE_KEY, raw)
    const api = mountPivot(ref([]))
    expect(api.config.value).toEqual(DEFAULT_CONFIG)
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h, ref, type Ref } from 'vue'
import { mount } from '@vue/test-utils'

import type { MatchRecord } from '@/api'
import { useMatchPivot } from '@/composables/matches/useMatchPivot'

function rec(data: Partial<MatchRecord['data']> = {}): MatchRecord {
  return { match_key: `m-${Math.random()}`, source_files: [], data: { ...data } } as unknown as MatchRecord
}

function mountPivot(records: Ref<MatchRecord[]>) {
  let api!: ReturnType<typeof useMatchPivot>
  mount(defineComponent({
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

describe('useMatchPivot — persistence', () => {
  it('persists config across instances', () => {
    const a = mountPivot(ref([]))
    a.assignField('map', 'rows')
    const b = mountPivot(ref([]))
    expect(b.config.value.rows).toEqual(['hero', 'map'])
  })

  it('falls back to the default on a corrupt persisted config', () => {
    localStorage.setItem('recall.matchesPivotConfig', '{"rows":["not-a-field"],"columns":[],"values":[],"filters":[]}')
    const api = mountPivot(ref([]))
    expect(api.config.value.rows).toEqual(['hero'])
  })
})

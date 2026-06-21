import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import { useColumnResize, DEFAULT_COLUMN_WIDTHS } from '@/composables/matches/useColumnResize'

// Mount the composable inside a throwaway component so usePersistedRef's
// lifecycle hooks bind to a real instance (mirrors useTableSort.test).
function mountResize() {
  let api!: ReturnType<typeof useColumnResize>
  mount(defineComponent({
    setup() {
      api = useColumnResize()
      return () => h('div')
    },
  }))
  return api
}

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

describe('useColumnResize', () => {
  it('returns the natural default width for an unsized column', () => {
    const api = mountResize()
    expect(api.colWidth('map')).toBe(DEFAULT_COLUMN_WIDTHS.map)
    expect(api.colWidth('hero')).toBe(DEFAULT_COLUMN_WIDTHS.hero)
  })

  it('reads a persisted width, and resetWidth drops it back to the default', () => {
    storage['recall.matchesTableColWidths'] = JSON.stringify({ map: 240 })
    const api = mountResize()
    expect(api.colWidth('map')).toBe(240)
    api.resetWidth('map')
    expect(api.colWidth('map')).toBe(DEFAULT_COLUMN_WIDTHS.map)
  })

  it('ignores a corrupt persisted value (falls back to defaults)', () => {
    storage['recall.matchesTableColWidths'] = '{"map":"wide"}'
    const api = mountResize()
    expect(api.colWidth('map')).toBe(DEFAULT_COLUMN_WIDTHS.map)
  })
})

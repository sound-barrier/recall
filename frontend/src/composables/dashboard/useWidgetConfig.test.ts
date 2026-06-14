import { describe, expect, it, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { makeSchema } from '@/dashboard/widget-config-schema'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'

// happy-dom's localStorage is a no-op without --localstorage-file
// (vitest's default config doesn't pass it). Mirror mountApp's
// in-memory shim so the persisted-pref round-trip actually persists.
function installLocalStorageShim(): Record<string, string> {
  const storage: Record<string, string> = {}
  vi.stubGlobal('localStorage', {
    getItem:    (k: string) => storage[k] ?? null,
    setItem:    (k: string, v: string) => { storage[k] = String(v) },
    removeItem: (k: string) => { delete storage[k] },
    clear:      () => { for (const k of Object.keys(storage)) delete storage[k] },
    key:        (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
  return storage
}

// usePersistedRef hydrates inside an onMounted hook, so the
// composable has to be exercised from inside a real mounted
// component for the localStorage round-trip to fire.
function mountConfig<T extends Record<string, unknown>>(
  id: string,
  schema: ReturnType<typeof makeSchema<T>>,
) {
  let api: ReturnType<typeof useWidgetConfig<T>> | null = null
  const Harness = defineComponent({
    setup() {
      api = useWidgetConfig<T>(id, schema)
      return () => h('div')
    },
  })
  const wrapper = mount(Harness)
  return { api: api!, wrapper }
}

const limitSchema = makeSchema<{ limit: number }>([
  { kind: 'integer-choice', key: 'limit', label: 'Top N', choices: [3, 5, 10], default: 5 },
])

describe('useWidgetConfig', () => {
  beforeEach(() => {
    installLocalStorageShim()
  })

  it('hydrates to schema defaults when localStorage is empty', () => {
    const { api } = mountConfig('top-heroes', limitSchema)
    expect(api.config.value).toEqual({ limit: 5 })
  })

  it('hydrates from a previously-persisted valid value', () => {
    localStorage.setItem('recall.dashboard.widget-config.top-heroes', JSON.stringify({ limit: 10 }))
    const { api } = mountConfig('top-heroes', limitSchema)
    expect(api.config.value).toEqual({ limit: 10 })
  })

  it('falls back to defaults when localStorage holds corrupt JSON', () => {
    localStorage.setItem('recall.dashboard.widget-config.top-heroes', '{not valid')
    const { api } = mountConfig('top-heroes', limitSchema)
    expect(api.config.value).toEqual({ limit: 5 })
  })

  it('self-heals invalid stored field values back to defaults', () => {
    localStorage.setItem('recall.dashboard.widget-config.top-heroes', JSON.stringify({ limit: 99 }))
    const { api } = mountConfig('top-heroes', limitSchema)
    expect(api.config.value).toEqual({ limit: 5 })
  })

  it('set() merges a partial update + persists to localStorage', () => {
    const { api } = mountConfig('top-heroes', limitSchema)
    api.set({ limit: 10 })
    expect(api.config.value).toEqual({ limit: 10 })
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes')).toBe(JSON.stringify({ limit: 10 }))
  })

  it('reset() rewrites the schema defaults + persists them', () => {
    const { api } = mountConfig('top-heroes', limitSchema)
    api.set({ limit: 10 })
    api.reset()
    expect(api.config.value).toEqual({ limit: 5 })
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes')).toBe(JSON.stringify({ limit: 5 }))
  })

  it('keys different widget ids independently', () => {
    const heroes = mountConfig('top-heroes', limitSchema)
    const maps = mountConfig('top-maps', limitSchema)
    heroes.api.set({ limit: 10 })
    expect(heroes.api.config.value).toEqual({ limit: 10 })
    expect(maps.api.config.value).toEqual({ limit: 5 })
    expect(localStorage.getItem('recall.dashboard.widget-config.top-heroes')).toBe(JSON.stringify({ limit: 10 }))
    expect(localStorage.getItem('recall.dashboard.widget-config.top-maps')).toBe(null)
  })

  it('multi-field schema preserves untouched fields on partial set', () => {
    const multi = makeSchema<{ limit: number; flag: boolean }>([
      { kind: 'integer-choice', key: 'limit', label: 'L', choices: [3, 5], default: 3 },
      { kind: 'boolean',        key: 'flag',  label: 'F', default: false },
    ])
    const { api } = mountConfig('multi-widget', multi)
    api.set({ limit: 5 })
    expect(api.config.value).toEqual({ limit: 5, flag: false })
    api.set({ flag: true })
    expect(api.config.value).toEqual({ limit: 5, flag: true })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import {
  useFilterPresets,
  parsePresetSnapshot,
  readStoredPresets,
  FILTER_PRESETS_STORAGE_KEY,
  type FilterPresetSnapshot,
  type UseFilterPresets,
} from './useFilterPresets'

let storage: Record<string, string>

function emptySnapshot(): FilterPresetSnapshot {
  return {
    filters: {
      mode: [], type: [], role: [], map: [],
      hero: [], result: [], sshot: [], tags: [],
    },
    noteSearch: '',
    filterFrom: '',
    filterTo: '',
    sortDir: 'desc',
    minPlayPercent: 0,
    minPlayMinutes: 0,
    includeUndated: false,
    leaverHandling: 'include',
    showHidden: false,
  }
}

function mountWith(): UseFilterPresets {
  let api!: UseFilterPresets
  const Comp = defineComponent({
    setup() {
      api = useFilterPresets()
      return () => h('div')
    },
  })
  mount(Comp)
  return api
}

describe('useFilterPresets', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
      removeItem: (key: string) => { delete storage[key] },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('starts empty when nothing stored', async () => {
    const { presets } = mountWith()
    await flushPromises()
    expect(presets.value).toEqual([])
  })

  it('savePreset adds a named entry and writes localStorage', async () => {
    const api = mountWith()
    await flushPromises()
    const snap = emptySnapshot()
    snap.filters.hero = ['juno']
    api.savePreset('Juno games', snap)
    expect(api.presets.value).toHaveLength(1)
    expect(api.presets.value[0]?.name).toBe('Juno games')
    expect(api.presets.value[0]?.snapshot.filters.hero).toEqual(['juno'])
    const raw = storage[FILTER_PRESETS_STORAGE_KEY]
    expect(raw).toBeTruthy()
    const parsed = JSON.parse(raw!)
    expect(parsed[0].name).toBe('Juno games')
  })

  it('savePreset trims whitespace and rejects empty names', async () => {
    const api = mountWith()
    await flushPromises()
    api.savePreset('   ', emptySnapshot())
    expect(api.presets.value).toEqual([])
    api.savePreset('  Stack night  ', emptySnapshot())
    expect(api.presets.value[0]?.name).toBe('Stack night')
  })

  it('savePreset replaces an existing preset of the same name', async () => {
    const api = mountWith()
    await flushPromises()
    const a = emptySnapshot()
    a.filters.hero = ['juno']
    api.savePreset('placements', a)
    const b = emptySnapshot()
    b.filters.hero = ['kiriko']
    api.savePreset('placements', b)
    expect(api.presets.value).toHaveLength(1)
    expect(api.presets.value[0]?.snapshot.filters.hero).toEqual(['kiriko'])
  })

  it('deletePreset removes the named entry and rewrites storage', async () => {
    const api = mountWith()
    await flushPromises()
    api.savePreset('a', emptySnapshot())
    api.savePreset('b', emptySnapshot())
    api.deletePreset('a')
    expect(api.presets.value.map(p => p.name)).toEqual(['b'])
    const parsed = JSON.parse(storage[FILTER_PRESETS_STORAGE_KEY] ?? '[]')
    expect(parsed.map((p: { name: string }) => p.name)).toEqual(['b'])
  })

  it('hydrates from stored value on mount', async () => {
    storage[FILTER_PRESETS_STORAGE_KEY] = JSON.stringify([
      {
        name: 'support only',
        snapshot: { ...emptySnapshot(), filters: { ...emptySnapshot().filters, role: ['support'] } },
        savedAt: 1234,
      },
    ])
    const api = mountWith()
    await flushPromises()
    expect(api.presets.value).toHaveLength(1)
    expect(api.presets.value[0]?.name).toBe('support only')
    expect(api.presets.value[0]?.snapshot.filters.role).toEqual(['support'])
  })

  it('hasPreset / getPreset work on the hydrated set', async () => {
    storage[FILTER_PRESETS_STORAGE_KEY] = JSON.stringify([
      { name: 'foo', snapshot: emptySnapshot(), savedAt: 1 },
    ])
    const api = mountWith()
    await flushPromises()
    expect(api.hasPreset('foo')).toBe(true)
    expect(api.hasPreset('bar')).toBe(false)
    expect(api.getPreset('foo')?.name).toBe('foo')
    expect(api.getPreset('bar')).toBeUndefined()
  })

  it('persists across remount via localStorage', async () => {
    const a = mountWith()
    await flushPromises()
    a.savePreset('only-juno', { ...emptySnapshot(), filters: { ...emptySnapshot().filters, hero: ['juno'] } })
    // Second mount reads what the first wrote.
    const b = mountWith()
    await flushPromises()
    expect(b.presets.value.map(p => p.name)).toEqual(['only-juno'])
    expect(b.presets.value[0]?.snapshot.filters.hero).toEqual(['juno'])
  })

  it('survives localStorage write failures without crashing', async () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceeded') },
    })
    const api = mountWith()
    await flushPromises()
    expect(() => api.savePreset('x', emptySnapshot())).not.toThrow()
    // The in-memory ref still updates so the session keeps working.
    expect(api.presets.value).toHaveLength(1)
  })

  it('readStoredPresets ignores malformed JSON / entries without names', () => {
    storage[FILTER_PRESETS_STORAGE_KEY] = '{not json'
    expect(readStoredPresets()).toEqual([])
    storage[FILTER_PRESETS_STORAGE_KEY] = JSON.stringify({ shape: 'wrong' })
    expect(readStoredPresets()).toEqual([])
    storage[FILTER_PRESETS_STORAGE_KEY] = JSON.stringify([
      { snapshot: emptySnapshot() },           // missing name
      { name: '   ', snapshot: emptySnapshot() }, // blank name
      { name: 'good', snapshot: emptySnapshot(), savedAt: 9 },
    ])
    expect(readStoredPresets().map(p => p.name)).toEqual(['good'])
  })
})

describe('parsePresetSnapshot', () => {
  it('returns a fully defaulted shape for completely unknown input', () => {
    const s = parsePresetSnapshot(null)
    expect(s.filters.hero).toEqual([])
    expect(s.sortDir).toBe('desc')
    expect(s.leaverHandling).toBe('include')
    expect(s.minPlayPercent).toBe(0)
    expect(s.includeUndated).toBe(false)
  })

  it('preserves valid fields, drops alien ones', () => {
    const s = parsePresetSnapshot({
      filters: { hero: ['juno'], tags: ['stack', 'stream'], bogus: ['ignored'] },
      noteSearch: 'clutch',
      sortDir: 'asc',
      leaverHandling: 'hide',
      minPlayPercent: 25,
      includeUndated: true,
      gibberish: 'ignored',
    })
    expect(s.filters.hero).toEqual(['juno'])
    expect(s.filters.tags).toEqual(['stack', 'stream'])
    expect(s.noteSearch).toBe('clutch')
    expect(s.sortDir).toBe('asc')
    expect(s.leaverHandling).toBe('hide')
    expect(s.minPlayPercent).toBe(25)
    expect(s.includeUndated).toBe(true)
  })

  it('clamps unknown leaverHandling back to include', () => {
    const s = parsePresetSnapshot({ leaverHandling: 'lol' })
    expect(s.leaverHandling).toBe('include')
  })

  it('drops non-string entries from filter arrays', () => {
    const s = parsePresetSnapshot({ filters: { hero: ['juno', 7, null, 'kiriko'] } })
    expect(s.filters.hero).toEqual(['juno', 'kiriko'])
  })
})

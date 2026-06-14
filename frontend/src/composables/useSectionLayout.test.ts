import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useSectionLayout,
  _resetSectionLayoutForTest,
  reconcileSections,
  isSectionStateArray,
  defaultSections,
  SECTIONS_STORAGE_KEY,
  type SectionState,
} from '@/composables/useSectionLayout'

let storage: Record<string, string> = {}
function stubLocalStorage() {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

async function mountHost(seed?: SectionState[] | string) {
  if (seed !== undefined) {
    storage[SECTIONS_STORAGE_KEY] = typeof seed === 'string' ? seed : JSON.stringify(seed)
  }
  let api!: ReturnType<typeof useSectionLayout>
  const Host = defineComponent({
    setup() {
      api = useSectionLayout()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  await nextTick()
  return { wrapper, api }
}

describe('isSectionStateArray', () => {
  it('accepts a well-formed array', () => {
    expect(isSectionStateArray([{ id: 'a', visible: true }])).toBe(true)
    expect(isSectionStateArray([])).toBe(true)
  })
  it('rejects malformed shapes', () => {
    expect(isSectionStateArray({})).toBe(false)
    expect(isSectionStateArray([{ id: 'a' }])).toBe(false)
    expect(isSectionStateArray([{ id: 1, visible: true }])).toBe(false)
    expect(isSectionStateArray([null])).toBe(false)
  })
})

describe('reconcileSections', () => {
  it('drops unknown + duplicate ids and appends missing registry ids visible', () => {
    const out = reconcileSections([
      { id: 'geography', visible: false },
      { id: 'mystery', visible: true },
      { id: 'geography', visible: true }, // dupe
    ])
    // geography kept (first occurrence, hidden), mystery dropped,
    // missing registry ids appended visible in registry order.
    expect(out).toEqual([
      { id: 'geography', visible: false },
      { id: 'campaign-log', visible: true },
      { id: 'hero-game-mode', visible: true },
    ])
  })
})

describe('useSectionLayout', () => {
  beforeEach(() => {
    _resetSectionLayoutForTest()
    stubLocalStorage()
  })
  afterEach(() => {
    _resetSectionLayoutForTest()
    vi.unstubAllGlobals()
  })

  it('defaults all sections visible in registry order', async () => {
    const { api } = await mountHost()
    expect(api.visibleIds.value).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
    expect(api.addable.value).toEqual([])
  })

  it('remove() hides a section and surfaces it as addable', async () => {
    const { api } = await mountHost()
    api.remove('geography')
    await nextTick()
    expect(api.visibleIds.value).toEqual(['campaign-log', 'hero-game-mode'])
    expect(api.addable.value.map((s) => s.id)).toEqual(['geography'])
    expect(api.isVisible('geography')).toBe(false)
    // Persisted.
    expect(JSON.parse(storage[SECTIONS_STORAGE_KEY] ?? '[]')).toContainEqual({ id: 'geography', visible: false })
  })

  it('add() re-shows a hidden section in its existing position', async () => {
    const { api } = await mountHost([
      { id: 'campaign-log', visible: true },
      { id: 'geography', visible: false },
    ])
    api.add('geography')
    await nextTick()
    expect(api.visibleIds.value).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
    expect(api.addable.value).toEqual([])
  })

  it('move() reorders the sections', async () => {
    const { api } = await mountHost()
    api.move(0, 1)
    await nextTick()
    expect(api.visibleIds.value).toEqual(['geography', 'campaign-log', 'hero-game-mode'])
  })

  it('move() is a no-op for out-of-range or same index', async () => {
    const { api } = await mountHost()
    api.move(0, 0)
    api.move(0, 9)
    api.move(-1, 1)
    await nextTick()
    expect(api.visibleIds.value).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
  })

  it('reset() restores the install default', async () => {
    const { api } = await mountHost([
      { id: 'geography', visible: false },
      { id: 'campaign-log', visible: false },
    ])
    api.reset()
    await nextTick()
    expect(api.sections.value).toEqual(defaultSections())
    expect(api.visibleIds.value).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
  })

  it('falls back to defaults on corrupt stored JSON', async () => {
    const { api } = await mountHost('not json {{{')
    expect(api.visibleIds.value).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
  })
})

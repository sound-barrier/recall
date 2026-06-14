import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useMatchAnchor,
  _resetMatchAnchorForTest,
  ANCHOR_STORAGE_KEY,
} from '@/composables/matches/useMatchAnchor'

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

async function mountHost(): Promise<ReturnType<typeof useMatchAnchor>> {
  let api!: ReturnType<typeof useMatchAnchor>
  const Host = defineComponent({
    setup() {
      api = useMatchAnchor()
      return () => h('div')
    },
  })
  mount(Host)
  await nextTick()
  return api
}

describe('useMatchAnchor', () => {
  beforeEach(() => {
    stubLocalStorage()
    _resetMatchAnchorForTest()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('starts with no anchor (empty string)', async () => {
    const api = await mountHost()
    expect(api.anchorKey.value).toBe('')
  })

  it('setAnchor persists the key to localStorage and updates the ref', async () => {
    const api = await mountHost()
    api.setAnchor('match-A')
    expect(api.anchorKey.value).toBe('match-A')
    expect(storage[ANCHOR_STORAGE_KEY]).toBe('match-A')
  })

  it('clearAnchor empties the ref and persists the empty value', async () => {
    const api = await mountHost()
    api.setAnchor('match-A')
    api.clearAnchor()
    expect(api.anchorKey.value).toBe('')
    expect(storage[ANCHOR_STORAGE_KEY]).toBe('')
  })

  it('hydrates from storage on mount', async () => {
    storage[ANCHOR_STORAGE_KEY] = 'match-Z'
    const api = await mountHost()
    expect(api.anchorKey.value).toBe('match-Z')
  })

  it('is a module singleton — second call returns the same api', async () => {
    const first = await mountHost()
    first.setAnchor('match-A')
    // A second call without _resetMatchAnchorForTest gives the same cached instance.
    const second = useMatchAnchor()
    expect(second).toBe(first)
    expect(second.anchorKey.value).toBe('match-A')
  })
})

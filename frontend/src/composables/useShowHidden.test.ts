import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { readStoredShowHidden, SHOW_HIDDEN_STORAGE_KEY, useShowHidden } from './useShowHidden'

describe('readStoredShowHidden', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  it('returns false when nothing is stored (default-off contract)', () => {
    expect(readStoredShowHidden()).toBe(false)
  })

  it('returns true when "true" is stored', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'true'
    expect(readStoredShowHidden()).toBe(true)
  })

  it('returns false when "false" is stored', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'false'
    expect(readStoredShowHidden()).toBe(false)
  })

  it('falls back to false for an unrecognized stored value', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'yes'
    expect(readStoredShowHidden()).toBe(false)
  })

  it('falls back to false when localStorage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('SecurityError') },
      setItem: () => {},
    })
    expect(readStoredShowHidden()).toBe(false)
  })
})

describe('useShowHidden — setter persistence', () => {
  let storage: Record<string, string>

  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })

  afterEach(() => { vi.unstubAllGlobals() })

  // Mount a tiny component so onMounted (the localStorage hydrate)
  // fires the same way it does in production.
  function mountWithComposable() {
    let api!: ReturnType<typeof useShowHidden>
    const Comp = defineComponent({
      setup() {
        api = useShowHidden()
        return () => h('div')
      },
    })
    mount(Comp)
    return api
  }

  it('setShowHidden(true) writes "true" to localStorage', () => {
    const { setShowHidden } = mountWithComposable()
    setShowHidden(true)
    expect(storage[SHOW_HIDDEN_STORAGE_KEY]).toBe('true')
  })

  it('setShowHidden(false) writes "false" (not unset) so the choice survives reloads', () => {
    storage[SHOW_HIDDEN_STORAGE_KEY] = 'true'
    const { setShowHidden } = mountWithComposable()
    setShowHidden(false)
    expect(storage[SHOW_HIDDEN_STORAGE_KEY]).toBe('false')
  })

  it('setter updates the ref synchronously', () => {
    const { showHidden, setShowHidden } = mountWithComposable()
    expect(showHidden.value).toBe(false)
    setShowHidden(true)
    expect(showHidden.value).toBe(true)
  })

  it('swallows localStorage write errors silently', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    })
    const { setShowHidden, showHidden } = mountWithComposable()
    setShowHidden(true)
    // The ref still updated; the storage write just failed quietly.
    expect(showHidden.value).toBe(true)
  })
})

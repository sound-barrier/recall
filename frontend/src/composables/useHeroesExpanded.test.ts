import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defineComponent, h } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { useHeroesExpanded, HEROES_EXPANDED_STORAGE_KEY } from './useHeroesExpanded'

let storage: Record<string, string>

function mountWith() {
  let api!: ReturnType<typeof useHeroesExpanded>
  const Comp = defineComponent({
    setup() {
      api = useHeroesExpanded()
      return () => h('div')
    },
  })
  mount(Comp)
  return api
}

describe('useHeroesExpanded', () => {
  beforeEach(() => {
    storage = {}
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value },
    })
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('defaults to true (expanded) when nothing stored', async () => {
    const { heroesExpanded } = mountWith()
    await flushPromises()
    expect(heroesExpanded.value).toBe(true)
  })

  it('hydrates from stored "false"', async () => {
    storage[HEROES_EXPANDED_STORAGE_KEY] = 'false'
    const { heroesExpanded } = mountWith()
    await flushPromises()
    expect(heroesExpanded.value).toBe(false)
  })

  it('toggleHeroesExpanded flips and persists', async () => {
    const { heroesExpanded, toggleHeroesExpanded } = mountWith()
    await flushPromises()
    toggleHeroesExpanded()
    expect(heroesExpanded.value).toBe(false)
    expect(storage[HEROES_EXPANDED_STORAGE_KEY]).toBe('false')
    toggleHeroesExpanded()
    expect(heroesExpanded.value).toBe(true)
    expect(storage[HEROES_EXPANDED_STORAGE_KEY]).toBe('true')
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useMapRoleConfig,
  _resetMapRoleConfigForTest,
  reconcileMapRoleConfig,
  isMapRoleConfig,
  MAP_ROLE_CONFIG_KEY,
  type MapRoleConfig,
} from '@/composables/useMapRoleConfig'

let storage: Record<string, string> = {}
function stubLocalStorage() {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => { storage[k] = v },
    removeItem: (k: string) => { delete storage[k] },
    clear: () => { storage = {} },
    key: (i: number) => Object.keys(storage)[i] ?? null,
    get length() { return Object.keys(storage).length },
  })
}

async function mountHost(seed?: MapRoleConfig | string) {
  if (seed !== undefined) {
    storage[MAP_ROLE_CONFIG_KEY] = typeof seed === 'string' ? seed : JSON.stringify(seed)
  }
  let api!: ReturnType<typeof useMapRoleConfig>
  const Host = defineComponent({ setup() { api = useMapRoleConfig(); return () => h('div') } })
  const wrapper = mount(Host)
  await nextTick()
  return { wrapper, api }
}

describe('isMapRoleConfig / reconcileMapRoleConfig', () => {
  it('accepts a well-formed config and rejects junk', () => {
    expect(isMapRoleConfig({ roles: [], gameModes: [], maps: [] })).toBe(true)
    expect(isMapRoleConfig({ roles: ['tank'] })).toBe(false)
    expect(isMapRoleConfig([])).toBe(false)
  })
  it('drops unknown roles/types + de-dupes, keeps map names', () => {
    expect(reconcileMapRoleConfig({
      roles: ['tank', 'tank', 'mystery'] as MapRoleConfig['roles'],
      gameModes: ['control', 'bogus'],
      maps: ['Rialto', 'Rialto'],
    })).toEqual({ roles: ['tank'], gameModes: ['control'], maps: ['Rialto'] })
  })
})

describe('useMapRoleConfig', () => {
  beforeEach(() => { _resetMapRoleConfigForTest(); stubLocalStorage() })
  afterEach(() => { _resetMapRoleConfigForTest(); vi.unstubAllGlobals() })

  it('defaults to everything (empty filters = show all)', async () => {
    const { api } = await mountHost()
    expect(api.config.value).toEqual({ roles: [], gameModes: [], maps: [] })
    expect(api.isDefault.value).toBe(true)
  })

  it('toggles roles / types / maps on and off + persists', async () => {
    const { api } = await mountHost()
    api.toggleRole('support'); await nextTick()
    api.toggleGameMode('control'); await nextTick()
    api.toggleMap('Rialto'); await nextTick()
    expect(api.config.value).toEqual({ roles: ['support'], gameModes: ['control'], maps: ['Rialto'] })
    expect(api.isDefault.value).toBe(false)
    expect(JSON.parse(storage[MAP_ROLE_CONFIG_KEY] ?? '{}')).toEqual(api.config.value)

    api.toggleRole('support'); await nextTick()
    expect(api.config.value.roles).toEqual([])
  })

  it('reset() clears all filters back to default', async () => {
    const { api } = await mountHost({ roles: ['tank'], gameModes: ['escort'], maps: ['Dorado'] })
    expect(api.isDefault.value).toBe(false)
    api.reset(); await nextTick()
    expect(api.config.value).toEqual({ roles: [], gameModes: [], maps: [] })
    expect(api.isDefault.value).toBe(true)
  })

  it('reconciles a seeded config on read (drops unknown role)', async () => {
    const { api } = await mountHost({ roles: ['support', 'mystery'] as MapRoleConfig['roles'], gameModes: [], maps: [] })
    expect(api.config.value.roles).toEqual(['support'])
  })

  it('falls back to default on corrupt JSON', async () => {
    const { api } = await mountHost('not json {{{')
    expect(api.config.value).toEqual({ roles: [], gameModes: [], maps: [] })
  })
})

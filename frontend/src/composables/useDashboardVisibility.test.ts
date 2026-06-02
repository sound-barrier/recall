import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useDashboardVisibility,
  _resetDashboardVisibilityForTest,
} from './useDashboardVisibility'
import { WIDGET_REGISTRY } from '../dashboard/widgets'

// In-memory localStorage stub. Matches the pattern used by every
// other composable test (useIncludeUnknown, useFirstRunAcknowledged,
// …) — happy-dom's localStorage is intentionally not relied on so
// the tests stay portable.
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

// Mounts a host component that calls the composable in setup() so
// the onMounted-driven hydrate fires the same way it does in
// production.
async function mountHost(seed?: string | null) {
  if (seed === null) {
    delete storage['recall.dashboard.hidden']
  } else if (seed !== undefined) {
    storage['recall.dashboard.hidden'] = seed
  }

  let api!: ReturnType<typeof useDashboardVisibility>
  const Host = defineComponent({
    setup() {
      api = useDashboardVisibility()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  await nextTick()
  return { wrapper, api }
}

const FIRST_WIDGET = WIDGET_REGISTRY[0]!.id
const SECOND_WIDGET = WIDGET_REGISTRY[1]!.id

describe('useDashboardVisibility', () => {
  beforeEach(() => {
    _resetDashboardVisibilityForTest()
    stubLocalStorage()
  })
  afterEach(() => {
    _resetDashboardVisibilityForTest()
    vi.unstubAllGlobals()
  })

  it('starts with every registered widget visible by default', async () => {
    const { api } = await mountHost(null)
    expect(api.hidden.value).toEqual([])
    expect(api.isHidden.value(FIRST_WIDGET)).toBe(false)
    const everyVisible = api.allWidgetStates.value.every((r) => r.visible)
    expect(everyVisible).toBe(true)
  })

  it('hide() and show() toggle a widget and persist to localStorage', async () => {
    const { api } = await mountHost(null)
    api.hide(FIRST_WIDGET)
    expect(api.hidden.value).toContain(FIRST_WIDGET)
    expect(storage['recall.dashboard.hidden']).toBe(FIRST_WIDGET)
    api.show(FIRST_WIDGET)
    expect(api.hidden.value).not.toContain(FIRST_WIDGET)
    expect(storage['recall.dashboard.hidden']).toBe('')
  })

  it('toggle() flips the visibility for a registered id', async () => {
    const { api } = await mountHost(null)
    expect(api.isHidden.value(FIRST_WIDGET)).toBe(false)
    api.toggle(FIRST_WIDGET)
    expect(api.isHidden.value(FIRST_WIDGET)).toBe(true)
    api.toggle(FIRST_WIDGET)
    expect(api.isHidden.value(FIRST_WIDGET)).toBe(false)
  })

  it('reset() restores the registry default', async () => {
    const { api } = await mountHost(`${FIRST_WIDGET},${SECOND_WIDGET}`)
    expect(api.hidden.value.sort()).toEqual([FIRST_WIDGET, SECOND_WIDGET].sort())
    api.reset()
    expect(api.hidden.value).toEqual([])
  })

  it('hydrates from a comma-delimited localStorage value', async () => {
    const { api } = await mountHost(`${FIRST_WIDGET},${SECOND_WIDGET}`)
    expect(api.isHidden.value(FIRST_WIDGET)).toBe(true)
    expect(api.isHidden.value(SECOND_WIDGET)).toBe(true)
  })

  it('drops orphan ids on read so stale localStorage degrades gracefully', async () => {
    const { api } = await mountHost(`${FIRST_WIDGET},nope-not-a-widget,${SECOND_WIDGET}`)
    expect(api.hidden.value.sort()).toEqual([FIRST_WIDGET, SECOND_WIDGET].sort())
    expect(api.isHidden.value('nope-not-a-widget')).toBe(false)
  })

  it('hide() is a no-op for unknown ids (no orphan write back)', async () => {
    const { api } = await mountHost(null)
    api.hide('nope-not-a-widget')
    expect(api.hidden.value).toEqual([])
    expect(storage['recall.dashboard.hidden']).toBeUndefined()
  })

  it('hide() is idempotent — double-hide stays single-entry', async () => {
    const { api } = await mountHost(null)
    api.hide(FIRST_WIDGET)
    api.hide(FIRST_WIDGET)
    expect(api.hidden.value).toEqual([FIRST_WIDGET])
  })

  it('allWidgetStates surfaces every registered widget with the current visibility', async () => {
    const { api } = await mountHost(FIRST_WIDGET)
    const states = api.allWidgetStates.value
    expect(states).toHaveLength(WIDGET_REGISTRY.length)
    const firstState = states.find((s) => s.id === FIRST_WIDGET)
    const secondState = states.find((s) => s.id === SECOND_WIDGET)
    expect(firstState?.visible).toBe(false)
    expect(secondState?.visible).toBe(true)
  })
})

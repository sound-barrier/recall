import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import DashboardCustomizer from './DashboardCustomizer.vue'
import {
  useDashboardVisibility,
  _resetDashboardVisibilityForTest,
} from '../composables/useDashboardVisibility'
import { WIDGET_REGISTRY } from '../dashboard/widgets'

const FIRST_WIDGET = WIDGET_REGISTRY[0]!.id

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

function mountCustomizer(open = true) {
  return mount(DashboardCustomizer, {
    props: { open },
    attachTo: document.body,
  })
}

describe('DashboardCustomizer', () => {
  beforeEach(() => {
    _resetDashboardVisibilityForTest()
    stubLocalStorage()
  })
  afterEach(() => {
    _resetDashboardVisibilityForTest()
    vi.unstubAllGlobals()
    // Safe DOM clear — replaceChildren() with no args removes all
    // children without going through the innerHTML parser.
    document.body.replaceChildren()
  })

  it('renders one toggle per registered widget', async () => {
    const w = mountCustomizer()
    await nextTick()
    const toggles = document.querySelectorAll('input[type="checkbox"][data-widget-toggle]')
    expect(toggles.length).toBe(WIDGET_REGISTRY.length)
    w.unmount()
  })

  it('checkbox change hides the widget through the composable', async () => {
    const w = mountCustomizer()
    await nextTick()
    // Access the composable's singleton after mount so the
    // setup-bound onMounted hydrate has run inside the customizer's
    // own component context.
    const visibility = useDashboardVisibility()
    const toggle = document.querySelector(
      `input[type="checkbox"][data-widget-toggle="${FIRST_WIDGET}"]`,
    ) as HTMLInputElement | null
    expect(toggle).not.toBeNull()
    expect(toggle!.checked).toBe(true)
    toggle!.checked = false
    toggle!.dispatchEvent(new Event('change'))
    await nextTick()
    expect(visibility.hidden.value).toContain(FIRST_WIDGET)
    w.unmount()
  })

  it('Reset to defaults clears the persisted hidden set', async () => {
    // Seed via storage directly so the composable's onMounted
    // hydrate picks it up — calling hide() outside a mounted
    // component fires the onMounted lifecycle warn from
    // usePersistedRef.
    storage['recall.dashboard.hidden'] = FIRST_WIDGET
    const w = mountCustomizer()
    await nextTick()
    const visibility = useDashboardVisibility()
    expect(visibility.hidden.value).toContain(FIRST_WIDGET)
    const resetBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('reset'),
    ) as HTMLButtonElement | undefined
    expect(resetBtn).not.toBeUndefined()
    resetBtn!.click()
    await nextTick()
    expect(visibility.hidden.value).toEqual([])
    w.unmount()
  })

  it('Done button emits close', async () => {
    const w = mountCustomizer()
    await nextTick()
    const doneBtn = Array.from(document.querySelectorAll('button')).find((b) =>
      b.textContent?.toLowerCase().includes('done'),
    ) as HTMLButtonElement | undefined
    doneBtn!.click()
    await nextTick()
    expect(w.emitted('close')).toBeTruthy()
    w.unmount()
  })

  it('does not render its body when open=false', async () => {
    const w = mountCustomizer(false)
    await nextTick()
    expect(document.querySelector('.dashboard-customizer-box')).toBeNull()
    w.unmount()
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'

import DashboardCustomizer from './DashboardCustomizer.vue'
import {
  useDashboardLayout,
  _resetDashboardLayoutForTest,
  LAYOUT_STORAGE_KEY,
  type RowLayout,
} from '../composables/useDashboardLayout'
import { WIDGET_REGISTRY, DEFAULT_ROW_LAYOUT } from '../dashboard/widgets'

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

function seedLayout(layout: RowLayout) {
  storage[LAYOUT_STORAGE_KEY] = JSON.stringify(layout)
}

function mountCustomizer(open = true) {
  return mount(DashboardCustomizer, {
    props: { open },
    attachTo: document.body,
  })
}

const FIRST_WIDGET = WIDGET_REGISTRY[0]!.id

describe('DashboardCustomizer', () => {
  beforeEach(() => {
    _resetDashboardLayoutForTest()
    stubLocalStorage()
  })
  afterEach(() => {
    _resetDashboardLayoutForTest()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('renders no add buttons when every widget is already on the layout', async () => {
    // Seed with the full default layout so every registered widget
    // sits in the layout — there's nothing addable.
    seedLayout({
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!],
    })
    const w = mountCustomizer()
    await nextTick()
    const adds = document.querySelectorAll('button[data-widget-add]')
    expect(adds.length).toBe(0)
    w.unmount()
  })

  it('surfaces widgets missing from the layout as + Add rows', async () => {
    // Seed with only the first widget removed from row 1. Reconciler
    // will NOT re-add it because the test seeds the row explicitly
    // without it — so it's "missing." Wait, the reconciler DOES re-add
    // it (it's an install-default widget). Use a layout-mutation
    // approach instead: seed full default, then remove via the
    // composable AFTER mount so the layout reflects the removal.
    seedLayout({
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!],
    })
    const w = mountCustomizer()
    await nextTick()
    const layout = useDashboardLayout()
    layout.removeFromRow(FIRST_WIDGET)
    await nextTick()
    const addBtn = document.querySelector(`button[data-widget-add="${FIRST_WIDGET}"]`)
    expect(addBtn).not.toBeNull()
    w.unmount()
  })

  it('+ Add button puts the widget back into the layout', async () => {
    seedLayout({
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!],
    })
    const w = mountCustomizer()
    await nextTick()
    const layout = useDashboardLayout()
    layout.removeFromRow(FIRST_WIDGET)
    await nextTick()
    const addBtn = document.querySelector(
      `button[data-widget-add="${FIRST_WIDGET}"]`,
    ) as HTMLButtonElement | null
    expect(addBtn).not.toBeNull()
    addBtn!.click()
    await nextTick()
    const allInLayout = Object.values(layout.rows.value).flat()
    expect(allInLayout).toContain(FIRST_WIDGET)
    w.unmount()
  })

  it('Reset layout button restores the install default', async () => {
    seedLayout({
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!],
    })
    const w = mountCustomizer()
    await nextTick()
    const layout = useDashboardLayout()
    layout.removeFromRow(FIRST_WIDGET)
    await nextTick()
    expect(Object.values(layout.rows.value).flat()).not.toContain(FIRST_WIDGET)
    const resetBtn = document.querySelector('button[data-reset-layout]') as HTMLButtonElement | null
    expect(resetBtn).not.toBeNull()
    resetBtn!.click()
    await nextTick()
    expect(Object.values(layout.rows.value).flat()).toContain(FIRST_WIDGET)
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

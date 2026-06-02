import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'

import {
  useDashboardLayout,
  _resetDashboardLayoutForTest,
  reconcile,
  isRowLayout,
  defaultLayout,
  LAYOUT_STORAGE_KEY,
  type RowLayout,
} from './useDashboardLayout'
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

async function mountHost(seed?: RowLayout | string) {
  if (seed !== undefined) {
    storage[LAYOUT_STORAGE_KEY] = typeof seed === 'string' ? seed : JSON.stringify(seed)
  }
  let api!: ReturnType<typeof useDashboardLayout>
  const Host = defineComponent({
    setup() {
      api = useDashboardLayout()
      return () => h('div')
    },
  })
  const wrapper = mount(Host)
  await nextTick()
  return { wrapper, api }
}

const KPI_IDS = WIDGET_REGISTRY.filter((w) => w.shape === 'kpi').map((w) => w.id)
const BREAKDOWN_IDS = WIDGET_REGISTRY.filter((w) => w.shape === 'breakdown').map((w) => w.id)

describe('isRowLayout', () => {
  it('accepts the default layout shape', () => {
    expect(isRowLayout(defaultLayout())).toBe(true)
  })
  it('rejects non-objects', () => {
    expect(isRowLayout(null)).toBe(false)
    expect(isRowLayout('whatever')).toBe(false)
    expect(isRowLayout([])).toBe(false)
  })
  it('rejects non-numeric keys', () => {
    expect(isRowLayout({ a: ['winrate'] })).toBe(false)
  })
  it('rejects non-array values', () => {
    expect(isRowLayout({ 1: 'winrate' })).toBe(false)
  })
  it('rejects non-string array entries', () => {
    expect(isRowLayout({ 1: ['winrate', 99] })).toBe(false)
  })
})

describe('reconcile', () => {
  it('returns defaultLayout for an empty input', () => {
    const result = reconcile({})
    expect(result[1]).toEqual([...DEFAULT_ROW_LAYOUT[1]!])
    expect(result[2]).toEqual([...DEFAULT_ROW_LAYOUT[2]!])
  })

  it('drops IDs no longer in the registry', () => {
    const stored: RowLayout = { 1: ['winrate', 'nope-not-a-widget'], 2: ['top-maps'] }
    const result = reconcile(stored)
    expect(result[1]).not.toContain('nope-not-a-widget')
    expect(result[1]).toContain('winrate')
  })

  it('dedupes — second occurrence dropped, first kept', () => {
    const stored: RowLayout = { 1: ['winrate', 'winrate'], 2: ['top-maps'] }
    const result = reconcile(stored)
    const winrateCount = Object.values(result).flat().filter((id) => id === 'winrate').length
    expect(winrateCount).toBe(1)
    expect(result[1]![0]).toBe('winrate')
  })

  it('appends registry widgets missing from the stored layout to their defaultRow', () => {
    const stored: RowLayout = { 1: ['winrate'], 2: [] }
    const result = reconcile(stored)
    // Every registered widget should appear exactly once across the
    // reconciled layout.
    const all = Object.values(result).flat()
    for (const def of WIDGET_REGISTRY) {
      expect(all).toContain(def.id)
    }
  })

  it('preserves user customizations when present', () => {
    // User has reordered Winrate to the END of row 1, and pulled
    // Top maps UP to row 1 — both still in stored layout.
    const stored: RowLayout = {
      1: ['avg-kda', 'total-time', 'top-maps', 'winrate'],
      2: ['top-heroes', 'top-roles'],
    }
    const result = reconcile(stored)
    expect(result[1]!.indexOf('avg-kda')).toBe(0)
    expect(result[1]!.indexOf('top-maps')).toBe(2)
    expect(result[1]!.indexOf('winrate')).toBe(3)
  })
})

describe('useDashboardLayout', () => {
  beforeEach(() => {
    _resetDashboardLayoutForTest()
    stubLocalStorage()
  })
  afterEach(() => {
    _resetDashboardLayoutForTest()
    vi.unstubAllGlobals()
  })

  it('starts with the registry default layout', async () => {
    const { api } = await mountHost()
    expect(api.rows.value[1]).toEqual([...DEFAULT_ROW_LAYOUT[1]!])
    expect(api.rows.value[2]).toEqual([...DEFAULT_ROW_LAYOUT[2]!])
  })

  it('move() within a row reorders correctly', async () => {
    const { api } = await mountHost()
    // Move Winrate (idx 0) to post-removal idx 2 in row 1.
    api.move('winrate', 1, 0, 1, 2)
    const row = api.rows.value[1]!
    // toIdx is the destination idx in the POST-REMOVAL row.
    // After removing winrate at idx 0, row = [avg-kda, total-time,
    // most-played-hero, ...]; inserting at idx 2 lands winrate
    // between total-time and most-played-hero → final idx 2.
    expect(row.indexOf('winrate')).toBe(2)
    expect(row[0]).toBe('avg-kda')
    expect(row[1]).toBe('total-time')
  })

  it('move() across rows works in one operation', async () => {
    const { api } = await mountHost()
    // Pull Top maps (row 2 idx 0) up to row 1 idx 0.
    api.move('top-maps', 2, 0, 1, 0)
    expect(api.rows.value[1]![0]).toBe('top-maps')
    expect(api.rows.value[2]).not.toContain('top-maps')
  })

  it('move() persists to localStorage', async () => {
    const { api } = await mountHost()
    api.move('top-maps', 2, 0, 1, 0)
    const stored = JSON.parse(storage[LAYOUT_STORAGE_KEY] ?? '{}')
    expect(stored[1]).toContain('top-maps')
  })

  it('move() with stale fromIdx still finds the widget', async () => {
    const { api } = await mountHost()
    // Caller thinks Winrate is at idx 3 but it's actually at idx 0.
    api.move('winrate', 1, 3, 1, 5)
    const row = api.rows.value[1]!
    // Winrate should have moved within row 1 despite the stale hint.
    const finalIdx = row.indexOf('winrate')
    expect(finalIdx).toBeGreaterThan(0)
  })

  it('reset() restores the registry default', async () => {
    const { api } = await mountHost()
    api.move('top-maps', 2, 0, 1, 0)
    expect(api.rows.value[1]).toContain('top-maps')
    api.reset()
    expect(api.rows.value[1]).not.toContain('top-maps')
    expect(api.rows.value[2]![0]).toBe('top-maps')
  })

  it('setRow() filters orphan IDs out of the writeback', async () => {
    const { api } = await mountHost()
    api.setRow(1, ['winrate', 'orphan-id', 'avg-kda'])
    // The orphan is dropped on write. The reconciler then re-
    // appends any registered widget that was dropped from row 1
    // back to its defaultRow (= 1 for the missing KPIs). The
    // explicit reorder still wins for the two we kept — they sit
    // at indices 0 and 1.
    const row = api.rows.value[1]!
    expect(row).not.toContain('orphan-id')
    expect(row[0]).toBe('winrate')
    expect(row[1]).toBe('avg-kda')
  })

  it('hydrates from a valid stored layout', async () => {
    const stored: RowLayout = {
      1: ['avg-kda', 'winrate'],
      2: ['top-roles', 'top-heroes', 'top-maps'],
    }
    const { api } = await mountHost(stored)
    expect(api.rows.value[1]![0]).toBe('avg-kda')
    expect(api.rows.value[2]![0]).toBe('top-roles')
  })

  it('falls back to defaults on corrupted JSON', async () => {
    const { api } = await mountHost('not a valid json {{{')
    expect(api.rows.value[1]).toEqual([...DEFAULT_ROW_LAYOUT[1]!])
  })

  it('falls back to defaults when the JSON shape mismatches', async () => {
    const { api } = await mountHost('{"foo": "bar"}')
    expect(api.rows.value[1]).toEqual([...DEFAULT_ROW_LAYOUT[1]!])
  })

  it('exposes the full registry across rows after any sequence of moves', async () => {
    const { api } = await mountHost()
    api.move('winrate', 1, 0, 2, 0)
    api.move('top-maps', 2, 0, 1, 0)
    const all = [...api.rows.value[1]!, ...api.rows.value[2]!]
    // Every registry widget should appear exactly once.
    for (const def of WIDGET_REGISTRY) {
      const count = all.filter((id) => id === def.id).length
      expect(count, `${def.id} appears ${count} times`).toBe(1)
    }
  })

  it('KPI-shape widgets can land in the breakdown row', async () => {
    // The cross-row move contract is shape-agnostic — Phase 3 lets
    // users put a KPI tile in the breakdown row. This is a sanity
    // check that the layout composable doesn't refuse the move
    // based on shape.
    const { api } = await mountHost()
    const someKpi = KPI_IDS[0]!
    api.move(someKpi, 1, 0, 2, 0)
    expect(api.rows.value[2]![0]).toBe(someKpi)
    expect(api.rows.value[1]).not.toContain(someKpi)
  })

  it('Breakdown-shape widgets can land in the KPI row', async () => {
    const { api } = await mountHost()
    const someBreakdown = BREAKDOWN_IDS[0]!
    api.move(someBreakdown, 2, 0, 1, 0)
    expect(api.rows.value[1]![0]).toBe(someBreakdown)
  })
})

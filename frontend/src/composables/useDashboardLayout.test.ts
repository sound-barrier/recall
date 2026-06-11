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
  it('returns empty default rows for an empty input (first-install seeding lives in defaultLayout)', () => {
    const result = reconcile({})
    expect(result[1]).toEqual([])
    expect(result[2]).toEqual([])
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

  it('preserves a user layout that omits an install-default widget (no ghost re-add)', () => {
    // The user has explicitly removed winrate. The reconciler must
    // honour that — re-adding install defaults would lose to every
    // trash click.
    const stored: RowLayout = {
      1: ['avg-kda', 'total-time'],
      2: ['top-maps'],
    }
    const result = reconcile(stored)
    const all = Object.values(result).flat()
    expect(all).not.toContain('winrate')
    expect(all).toContain('avg-kda')
  })

  it('seeds an omitted default-row index as an empty array', () => {
    const stored: RowLayout = { 1: ['winrate'] }
    const result = reconcile(stored)
    expect(result[2]).toEqual([])
  })

  it('does NOT auto-add registry widgets that are absent from the stored layout', () => {
    // Pre-PR-B every registered widget is in DEFAULT_ROW_LAYOUT; the
    // assertion is still meaningful via a removed install-default.
    const stored: RowLayout = { 1: [], 2: [] }
    const result = reconcile(stored)
    const all = Object.values(result).flat()
    for (const def of WIDGET_REGISTRY) {
      expect(all).not.toContain(def.id)
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

  it('exposes every default-install widget exactly once after any sequence of moves', async () => {
    // PR B: opt-in widgets sit in WIDGET_REGISTRY but are intentionally
    // absent from the layout until the user adds them via the
    // customizer. The invariant for installed widgets is "exactly once
    // across all rows."
    const defaultIds = new Set(Object.values(DEFAULT_ROW_LAYOUT).flat())
    const { api } = await mountHost()
    api.move('winrate', 1, 0, 2, 0)
    api.move('top-maps', 2, 0, 1, 0)
    const all = Object.values(api.rows.value).flat()
    for (const def of WIDGET_REGISTRY) {
      if (!defaultIds.has(def.id)) continue
      const count = all.filter((id) => id === def.id).length
      expect(count, `${def.id} appears ${count} times`).toBe(1)
    }
    // And no opt-in widget snuck into the layout.
    for (const def of WIDGET_REGISTRY) {
      if (defaultIds.has(def.id)) continue
      expect(all.includes(def.id), `opt-in widget ${def.id} should not be in the layout`).toBe(false)
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

  // ─── appendToRow ─────────────────────────────────────────────
  // We exercise appendToRow by first removing a default-install
  // widget (so it's "missing" from the layout) and then adding it
  // back, possibly with the threshold spill triggered.

  it('appendToRow puts the id at the tail of the requested row when under threshold', async () => {
    const { api } = await mountHost()
    const someBreakdown = BREAKDOWN_IDS[0]!
    api.removeFromRow(someBreakdown)
    expect(api.rows.value[2]).not.toContain(someBreakdown)
    api.appendToRow(2, someBreakdown)
    const row2 = api.rows.value[2]!
    expect(row2[row2.length - 1]).toBe(someBreakdown)
  })

  it('appendToRow is a no-op when the id already lives in the layout', async () => {
    const { api } = await mountHost()
    const id = KPI_IDS[0]!
    const before = JSON.stringify(api.rows.value)
    api.appendToRow(1, id)
    expect(JSON.stringify(api.rows.value)).toBe(before)
  })

  it('appendToRow spills to a fresh overflow row when KPIs >= 5', async () => {
    const { api } = await mountHost()
    // Default row 1 ships with 7 KPIs (already >= 5). Adding any
    // KPI now should land on row 3, not row 1.
    const kpi = KPI_IDS[0]!
    api.removeFromRow(kpi)
    expect(api.rows.value[1]).not.toContain(kpi)
    api.appendToRow(1, kpi)
    expect(api.rows.value[1]).not.toContain(kpi)
    expect(api.rows.value[3]).toEqual([kpi])
  })

  it('appendToRow spills to a fresh overflow row when breakdowns >= 4', async () => {
    // PR B unblocks this case: the registry now holds 7 breakdowns
    // (3 default + 4 opt-in), so the soft cap of 4 can be reached.
    // The test seeds row 2 to 4 default-install breakdowns, then
    // tries to add a 5th breakdown — it should spill to a fresh
    // overflow row instead of growing row 2.
    const breakdowns = WIDGET_REGISTRY
      .filter((w) => w.shape === 'breakdown')
      .map((w) => w.id)
    expect(breakdowns.length).toBeGreaterThanOrEqual(5)
    const seed: RowLayout = {
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: breakdowns.slice(0, 4),
    }
    const { api } = await mountHost(seed)
    expect(api.rows.value[2]).toHaveLength(4)
    const fifth = breakdowns[4]!
    api.removeFromRow(fifth)
    api.appendToRow(2, fifth)
    expect(api.rows.value[2]).not.toContain(fifth)
    // Spill lands on the next-available row index past every
    // currently-occupied row (= 3 here).
    expect(api.rows.value[3]).toEqual([fifth])
  })

  // ─── removeFromRow ───────────────────────────────────────────

  it('removeFromRow splices the widget out of its row', async () => {
    const { api } = await mountHost()
    const id = KPI_IDS[0]!
    api.removeFromRow(id)
    const all = Object.values(api.rows.value).flat()
    expect(all).not.toContain(id)
  })

  it('removeFromRow is a no-op for an id not in the layout', async () => {
    const { api } = await mountHost()
    const before = JSON.stringify(api.rows.value)
    api.removeFromRow('definitely-not-a-widget')
    expect(JSON.stringify(api.rows.value)).toBe(before)
  })

  it('removeFromRow auto-prunes an emptied overflow row past the last default row', async () => {
    const { api } = await mountHost()
    // Default row 1 ships with 7 KPIs (over the 5-KPI cap), so
    // adding a KPI to row 1 spills into row 3 automatically.
    const kpi = KPI_IDS[0]!
    api.removeFromRow(kpi)
    api.appendToRow(1, kpi)
    expect(api.rows.value[3]).toEqual([kpi])
    // Removing the only widget in row 3 should drop the row.
    api.removeFromRow(kpi)
    expect(api.rows.value[3]).toBeUndefined()
  })

  // ─── setLayout ──────────────────────────────────────────────

  it('setLayout writes the provided layout atomically and persists', async () => {
    const { api } = await mountHost()
    const swap: RowLayout = {
      1: ['avg-kda', 'winrate'],
      2: ['top-heroes', 'top-maps', 'top-roles'],
    }
    api.setLayout(swap)
    expect(api.rows.value[1]).toEqual(['avg-kda', 'winrate'])
    expect(api.rows.value[2]).toEqual(['top-heroes', 'top-maps', 'top-roles'])
    // Storage round-tripped.
    const stored = JSON.parse(storage[LAYOUT_STORAGE_KEY] ?? '{}')
    expect(stored[1]).toEqual(['avg-kda', 'winrate'])
  })

  it('setLayout drops orphan IDs that no longer exist in the registry', async () => {
    const { api } = await mountHost()
    api.setLayout({
      1: ['winrate', 'definitely-not-a-widget'],
      2: ['top-maps'],
    })
    expect(api.rows.value[1]).not.toContain('definitely-not-a-widget')
    expect(api.rows.value[1]).toEqual(['winrate'])
  })

  it('setLayout takes the layout literally — drops install-default widgets the caller omits', async () => {
    const { api } = await mountHost()
    // PR A's reconciler intentionally does NOT re-add install-default
    // widgets that the caller omits — otherwise every trash click
    // would lose to a ghost re-add on reload. setLayout inherits
    // that contract: the layout the caller writes is the layout
    // that gets persisted.
    api.setLayout({ 1: ['winrate'], 2: ['top-maps'] })
    expect(api.rows.value[1]).toEqual(['winrate'])
    expect(api.rows.value[2]).toEqual(['top-maps'])
    const all = Object.values(api.rows.value).flat()
    expect(all).not.toContain('avg-kda')
    expect(all).not.toContain('top-heroes')
  })

  // ─── appendToRow row-packing (vs each-add-spawns-new-row) ──

  it('appendToRow packs into the FIRST existing same-shape row with capacity', async () => {
    // Seed: row 1 is at the 5-KPI cap, row 3 already holds a single
    // KPI (an earlier overflow). Adding another KPI should fill row 3
    // rather than spawn row 4 — the per-add-spawns-a-new-row bug
    // was the source of the user's 9-row dossier mess.
    const kpis = WIDGET_REGISTRY.filter((w) => w.shape === 'kpi').map((w) => w.id)
    expect(kpis.length).toBeGreaterThanOrEqual(7)
    const seed: RowLayout = {
      1: kpis.slice(0, 5),
      2: [],
      3: [kpis[5]!],
    }
    const { api } = await mountHost(seed)
    const seventh = kpis[6]!
    api.removeFromRow(seventh)
    api.appendToRow(1, seventh)
    expect(api.rows.value[3]).toEqual([kpis[5], seventh])
    expect(api.rows.value[4]).toBeUndefined()
  })

  it('appendToRow does not pollute a row of the opposite shape', async () => {
    // Row 1 is at cap (5 KPIs); row 2 has empty room but holds
    // breakdowns. Adding another KPI must NOT land in row 2 —
    // shape-mixed rows break the dossier's visual rhythm. Spawn a
    // fresh overflow row instead.
    const kpis = WIDGET_REGISTRY.filter((w) => w.shape === 'kpi').map((w) => w.id)
    const seed: RowLayout = {
      1: kpis.slice(0, 5),
      2: ['top-maps'],
    }
    const { api } = await mountHost(seed)
    const sixth = kpis[5]!
    api.removeFromRow(sixth)
    api.appendToRow(1, sixth)
    expect(api.rows.value[2]).not.toContain(sixth)
    expect(api.rows.value[3]).toEqual([sixth])
  })

  // ─── one-shot consolidation migration ─────────────────────

  it('migrates a buggy "each-add-on-its-own-row" layout into shape-packed rows', async () => {
    // Reproduces the user's exact broken state from localStorage:
    // 11 KPIs + 7 breakdowns, the 4 opt-in KPIs and 3 opt-in
    // breakdowns each stranded in their own single-widget row.
    const seed: RowLayout = {
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!, 'recent-5-matches'],
      3: ['current-streak'],
      4: ['hero-pool-size'],
      5: ['longest-win-streak'],
      6: ['best-winrate-hero'],
      7: ['time-of-day'],
      8: ['day-of-week'],
      9: ['top-game-modes'],
    }
    const { api } = await mountHost(seed)
    // Default rows untouched — migration only re-packs overflow
    // rows past the highest default row.
    expect(api.rows.value[1]).toEqual(DEFAULT_ROW_LAYOUT[1])
    expect(api.rows.value[2]).toEqual([...DEFAULT_ROW_LAYOUT[2]!, 'recent-5-matches'])
    // The 4 single-KPI rows pack into row 3.
    expect(api.rows.value[3]).toEqual([
      'current-streak', 'hero-pool-size', 'longest-win-streak', 'best-winrate-hero',
    ])
    // The 3 single-breakdown rows pack into row 4.
    expect(api.rows.value[4]).toEqual(['time-of-day', 'day-of-week', 'top-game-modes'])
    // Stale higher-index rows are gone.
    expect(api.rows.value[5]).toBeUndefined()
    expect(api.rows.value[9]).toBeUndefined()
  })

  it('migration respects same-shape soft cap when packing', async () => {
    // 6 single-KPI rows; with the cap of 5, packing must split into
    // a 5-and-1 pair rather than smushing all 6 into one row.
    const kpis = WIDGET_REGISTRY.filter((w) => w.shape === 'kpi').map((w) => w.id)
    const seed: RowLayout = {
      1: [],
      2: [],
      3: [kpis[0]!],
      4: [kpis[1]!],
      5: [kpis[2]!],
      6: [kpis[3]!],
      7: [kpis[4]!],
      8: [kpis[5]!],
    }
    const { api } = await mountHost(seed)
    expect(api.rows.value[3]).toEqual(kpis.slice(0, 5))
    expect(api.rows.value[4]).toEqual([kpis[5]])
  })

  it('migration is one-shot — subsequent mounts do not re-pack', async () => {
    // First mount migrates a broken layout. Second mount, after a
    // mutation that re-introduces a single-widget overflow row,
    // leaves it alone — the layoutVersion sentinel records "already
    // migrated."
    const seed: RowLayout = {
      1: [...DEFAULT_ROW_LAYOUT[1]!],
      2: [...DEFAULT_ROW_LAYOUT[2]!],
      3: ['current-streak'],
      4: ['hero-pool-size'],
    }
    const { api: first } = await mountHost(seed)
    expect(first.rows.value[3]).toEqual(['current-streak', 'hero-pool-size'])
    // User intentionally separates the two via setLayout — recreates
    // the "single widget in row 4" shape on purpose.
    first.setLayout({
      ...first.rows.value,
      3: ['current-streak'],
      4: ['hero-pool-size'],
    })
    // Second mount of the cached layout — the migration must NOT
    // run again. Re-import to bust the module cache.
    _resetDashboardLayoutForTest()
    const { api: second } = await mountHost()
    expect(second.rows.value[3]).toEqual(['current-streak'])
    expect(second.rows.value[4]).toEqual(['hero-pool-size'])
  })
})

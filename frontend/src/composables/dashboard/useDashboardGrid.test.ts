import { defineComponent, h, nextTick } from 'vue'
import { render } from '@testing-library/vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDashboardGrid } from '@/composables/dashboard/useDashboardGrid'
import {
  CURRENT_LAYOUT_VERSION,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION_KEY,
  _resetDashboardLayoutForTest,
  type RowLayout,
} from '@/composables/dashboard/useDashboardLayout'

type GridApi = ReturnType<typeof useDashboardGrid>

// A deliberately small dossier so every expected order below is
// readable: three KPIs on row 1, two breakdowns on row 2.
const SEED: RowLayout = {
  1: ['winrate', 'avg-kda', 'tilt-check'],
  2: ['current-rank', 'winrate-by-map'],
}

// happy-dom exposes no global localStorage under this runner, and the
// layout composable reads it through a try/catch — without a stub every
// seed would silently fall back to the shipped defaults.
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

// Seeds stamp the current layout version: these are behavior tests, not
// migration tests, so the one-shot migrations must stay out of the way.
function mountGrid(seed: RowLayout = SEED, version: number = CURRENT_LAYOUT_VERSION) {
  storage[LAYOUT_STORAGE_KEY] = JSON.stringify(seed)
  storage[LAYOUT_VERSION_KEY] = String(version)
  let api!: GridApi
  const Host = defineComponent({
    setup() {
      api = useDashboardGrid()
      return () => h('div')
    },
  })
  const view = render(Host)
  return { view, api }
}

// What the user sees in a row, in render order.
function renderedRow(api: GridApi, row: number): string[] {
  return api.dashboardRows.value.find((r) => r.index === row)?.widgets.map((w) => w.id) ?? []
}

// What survives a reload.
function persistedRow(row: number): string[] {
  const parsed = JSON.parse(storage[LAYOUT_STORAGE_KEY] ?? '{}') as Record<string, string[]>
  return parsed[String(row)] ?? []
}

// The drag engine only reads preventDefault / dataTransfer / currentTarget
// off the event; a null currentTarget simply means "not mid-animation".
function dragEvent(): DragEvent {
  return {
    preventDefault: () => undefined,
    dataTransfer: null,
    currentTarget: null,
  } as unknown as DragEvent
}

// The gear button whose rect anchors the settings popover.
function gearClick(): MouseEvent {
  const button = document.createElement('button')
  button.getBoundingClientRect = () => ({ top: 120, left: 40, width: 24, height: 24 }) as DOMRect
  return { currentTarget: button } as unknown as MouseEvent
}

beforeEach(() => {
  _resetDashboardLayoutForTest()
  stubLocalStorage()
})

afterEach(() => {
  _resetDashboardLayoutForTest()
  vi.unstubAllGlobals()
})

describe('useDashboardGrid — rendered rows', () => {
  it('orders rows numerically and silently drops retired widget ids', async () => {
    // Row 10 sorts before row 2 under a string compare — the dossier
    // would render the overflow row above the breakdowns.
    const { api } = mountGrid({
      1: ['winrate', 'a-widget-we-deleted'],
      2: ['current-rank'],
      10: ['avg-kda'],
    })
    await nextTick()

    expect(api.dashboardRows.value.map((r) => r.index)).toEqual([1, 2, 10])
    expect(renderedRow(api, 1)).toEqual(['winrate'])
  })

  it('renders the migrated layout after an upgrade, not the raw stored one', async () => {
    // A v1 user opening the dossier for the first time on this build:
    // the grid must read through the migrating layout API, so the
    // re-seeded climb defaults are what renders — with the widget the
    // user added themselves still on its own row.
    const { api } = mountGrid({
      1: ['winrate', 'total-time', 'reviewed-count'],
      2: ['top-maps', 'top-heroes'],
      3: ['sessions'],
    }, 1)
    await nextTick()

    expect(renderedRow(api, 1)).toContain('form-delta')
    expect(renderedRow(api, 1)).not.toContain('total-time')
    expect(renderedRow(api, 3)).toEqual(['sessions'])
  })
})

describe('useDashboardGrid — drag reorder', () => {
  it('previews the drop slot while the drag is in flight, without persisting it', async () => {
    const { api } = mountGrid()

    api.dragReorder.onDragStart('winrate', 1, 0, dragEvent())
    api.dragReorder.onDragOver(1, 2, dragEvent())
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['avg-kda', 'tilt-check', 'winrate'])
    // A drag the user abandons must leave nothing behind on disk.
    expect(persistedRow(1)).toEqual(['winrate', 'avg-kda', 'tilt-check'])
  })

  it('reverts to the stored order when the drag ends off any cell', async () => {
    const { api } = mountGrid()

    api.dragReorder.onDragStart('winrate', 1, 0, dragEvent())
    api.dragReorder.onDragOver(1, 2, dragEvent())
    await nextTick()
    api.dragReorder.onDragEnd()
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['winrate', 'avg-kda', 'tilt-check'])
  })

  it('commits exactly the previewed order on drop', async () => {
    const { api } = mountGrid()

    api.dragReorder.onDragStart('winrate', 1, 0, dragEvent())
    api.dragReorder.onDragOver(1, 2, dragEvent())
    await nextTick()
    api.dragReorder.onDrop(1, 2, dragEvent())
    await nextTick()

    // What the user saw mid-drag is what lands — no second index
    // translation between the preview and the write.
    expect(renderedRow(api, 1)).toEqual(['avg-kda', 'tilt-check', 'winrate'])
    expect(persistedRow(1)).toEqual(['avg-kda', 'tilt-check', 'winrate'])
  })

  it('moves a widget into another row at the hinted slot', async () => {
    const { api } = mountGrid()

    api.dragReorder.onDragStart('winrate', 1, 0, dragEvent())
    api.dragReorder.onDragOver(2, 1, dragEvent())
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['avg-kda', 'tilt-check'])
    expect(renderedRow(api, 2)).toEqual(['current-rank', 'winrate', 'winrate-by-map'])
  })

  it('pulls a widget up out of a later row', async () => {
    // The source row is found by scanning, not by trusting the drag's
    // own coordinates — a widget dragged out of row 2 must leave row 2.
    const { api } = mountGrid()

    api.dragReorder.onDragStart('current-rank', 2, 0, dragEvent())
    api.dragReorder.onDragOver(1, 1, dragEvent())
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['winrate', 'current-rank', 'avg-kda', 'tilt-check'])
    expect(renderedRow(api, 2)).toEqual(['winrate-by-map'])
  })

  it('clamps a hint past the end of a row to an append', async () => {
    const { api } = mountGrid()

    api.dragReorder.onDragStart('winrate', 1, 0, dragEvent())
    api.dragReorder.onDragOver(2, 99, dragEvent())
    await nextTick()

    expect(renderedRow(api, 2)).toEqual(['current-rank', 'winrate-by-map', 'winrate'])
  })

  it('reorders by keyboard without a drag preview to commit', async () => {
    const { api } = mountGrid()

    // No dragstart — the handle's ArrowRight goes through the layout's
    // own move(), the branch the preview commit would otherwise hide.
    api.dragReorder.onHandleKeydown('winrate', 1, 0, new KeyboardEvent('keydown', { key: 'ArrowRight' }))
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['avg-kda', 'winrate', 'tilt-check'])
    expect(persistedRow(1)).toEqual(['avg-kda', 'winrate', 'tilt-check'])
  })
})

describe('useDashboardGrid — trash and undo', () => {
  it('puts a trashed widget back on the row it came from', async () => {
    const { api } = mountGrid()

    api.onWidgetRemove('avg-kda')
    await nextTick()
    expect(renderedRow(api, 1)).toEqual(['winrate', 'tilt-check'])
    expect(api.pendingUndo.value).toMatchObject({ id: 'avg-kda', row: 1, idx: 1 })

    api.onUndoRemove(api.pendingUndo.value!.token)
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['winrate', 'tilt-check', 'avg-kda'])
    expect(api.pendingUndo.value).toBeNull()
  })

  it('returns a widget to its own row, not the first one', async () => {
    const { api } = mountGrid()

    api.onWidgetRemove('winrate-by-map')
    await nextTick()
    expect(api.pendingUndo.value).toMatchObject({ row: 2, idx: 1 })

    api.onUndoRemove(api.pendingUndo.value!.token)
    await nextTick()

    expect(renderedRow(api, 2)).toEqual(['current-rank', 'winrate-by-map'])
    expect(renderedRow(api, 1)).toEqual(['winrate', 'avg-kda', 'tilt-check'])
  })

  it('ignores an undo whose toast has already been superseded', async () => {
    const { api } = mountGrid()

    api.onWidgetRemove('avg-kda')
    const staleToken = api.pendingUndo.value!.token
    api.onWidgetRemove('tilt-check')
    await nextTick()
    expect(api.pendingUndo.value!.token).not.toBe(staleToken)

    // The first toast's Undo, clicked after the second remove: it must
    // not resurrect a widget the newer toast isn't offering — and the
    // first toast timing out must not cancel the newer one.
    api.onUndoRemove(staleToken)
    api.onDismissUndo(staleToken)
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['winrate'])
    expect(api.pendingUndo.value).toMatchObject({ id: 'tilt-check' })
  })

  it('forgets the pending undo once its toast is dismissed', async () => {
    const { api } = mountGrid()

    api.onWidgetRemove('avg-kda')
    const token = api.pendingUndo.value!.token
    api.onDismissUndo(token)
    expect(api.pendingUndo.value).toBeNull()

    api.onUndoRemove(token)
    await nextTick()

    expect(renderedRow(api, 1)).toEqual(['winrate', 'tilt-check'])
  })

  it('ignores a remove for an id the registry does not know', () => {
    const { api } = mountGrid()

    api.onWidgetRemove('a-widget-we-deleted')

    expect(api.pendingUndo.value).toBeNull()
  })
})

describe('useDashboardGrid — settings popover', () => {
  it('anchors the gear popover to the button that opened it, and clears both on close', () => {
    const { api } = mountGrid()

    api.onWidgetConfigure('winrate', gearClick())

    expect(api.configureWidgetId.value).toBe('winrate')
    expect(api.configureDef.value?.id).toBe('winrate')
    expect(api.configureAnchor.value?.top).toBe(120)

    api.closeWidgetConfigure()

    expect(api.configureWidgetId.value).toBeNull()
    expect(api.configureAnchor.value).toBeNull()
    expect(api.configureDef.value).toBeNull()
  })

  it('does not open an unanchored popover', () => {
    const { api } = mountGrid()

    api.onWidgetConfigure('winrate', { currentTarget: null } as unknown as MouseEvent)

    expect(api.configureWidgetId.value).toBeNull()
  })
})

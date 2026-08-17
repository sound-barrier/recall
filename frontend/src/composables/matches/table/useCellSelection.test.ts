import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

import { useCellSelection } from '@/composables/matches/table/useCellSelection'
import type { TableSortCol } from '@/composables/matches/table/useTableSort'
import type { MatchRecord } from '@/api-client'

// Four rows / three columns is the smallest grid where a rectangle can
// have a strict interior AND rows outside it on both sides — enough to
// catch an inclusive/exclusive slip in either axis.
function row(key: string, map: string, result: string): MatchRecord {
  return { match_key: key, data: { map, result } } as unknown as MatchRecord
}

const COLS: readonly TableSortCol[] = ['map', 'result', 'hero']
const heroRole = () => 'damage'

function grid() {
  return ref([
    row('k0', 'Rialto', 'victory'),
    row('k1', 'Ilios', 'defeat'),
    row('k2', 'Numbani', 'draw'),
    row('k3', 'Busan', 'victory'),
  ])
}

let writeText: ReturnType<typeof vi.fn>
beforeEach(() => {
  writeText = vi.fn(async () => undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
})

describe('useCellSelection', () => {
  it('holds no rectangle until a drag starts, and copies nothing', async () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    expect(sel.hasSelection.value).toBe(false)
    expect(sel.selectedColsFor('k1')).toEqual([])
    await expect(sel.copy()).resolves.toBe('')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('normalizes a backwards drag into the enclosing rectangle', () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    // Start bottom-right, drag up-left: the rectangle must still be
    // rows 1–2 × cols 0–1, not an empty/inverted range.
    sel.startAt('k2', 2)
    sel.extendTo('k1', 0)

    expect(sel.hasSelection.value).toBe(true)
    expect(sel.selectedColsFor('k1')).toEqual([0, 1, 2])
    expect(sel.selectedColsFor('k2')).toEqual([0, 1, 2])
    // Rows on either side of the rectangle stay unselected.
    expect(sel.selectedColsFor('k0')).toEqual([])
    expect(sel.selectedColsFor('k3')).toEqual([])
  })

  it('selects a single cell when the drag never leaves its origin', () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    sel.startAt('k1', 1)
    expect(sel.selectedColsFor('k1')).toEqual([1])
    expect(sel.selectedColsFor('k0')).toEqual([])
  })

  it('freezes the rectangle on endDrag — a later extendTo is ignored', () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    sel.startAt('k0', 0)
    sel.extendTo('k1', 1)
    sel.endDrag()
    // Pointer keeps moving over the table after mouseup; the committed
    // selection must not follow it.
    sel.extendTo('k3', 2)
    expect(sel.selectedColsFor('k3')).toEqual([])
    expect(sel.selectedColsFor('k1')).toEqual([0, 1])
  })

  it('drops the rectangle when a selected row leaves the narrowed set', () => {
    const rows = grid()
    const sel = useCellSelection(rows, COLS, heroRole)
    sel.startAt('k1', 0)
    sel.extendTo('k2', 1)
    expect(sel.hasSelection.value).toBe(true)

    // Re-narrowing (or a delete) drops k1 — the anchor's row index no
    // longer resolves, so the highlight must collapse rather than
    // silently re-point at whatever slid into that index.
    rows.value = rows.value.filter((r) => r.match_key !== 'k1')
    expect(sel.hasSelection.value).toBe(false)
    expect(sel.selectedColsFor('k2')).toEqual([])
  })

  it('copies only the selected rectangle, tab-joined per row', async () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    sel.startAt('k1', 0)
    sel.extendTo('k2', 1)

    await expect(sel.copy()).resolves.toBe('Ilios\tdefeat\nNumbani\tdraw')
    expect(writeText).toHaveBeenCalledWith('Ilios\tdefeat\nNumbani\tdraw')
  })

  it('clear() drops both the rectangle and the dragging state', () => {
    const sel = useCellSelection(grid(), COLS, heroRole)
    sel.startAt('k0', 0)
    sel.clear()
    expect(sel.hasSelection.value).toBe(false)
    expect(sel.dragging.value).toBe(false)
    // A cleared selection must not resume on the next pointer move.
    sel.extendTo('k3', 2)
    expect(sel.hasSelection.value).toBe(false)
  })
})

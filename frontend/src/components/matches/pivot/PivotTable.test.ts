import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import PivotTable from '@/components/matches/pivot/PivotTable.vue'

// The pivot builder end to end: chip menus drive the shelves, the shelves
// drive the crosstab, and every move announces itself. Drag-and-drop is the
// e2e suite's job (HTML5 DnD needs a real browser); the keyboard menu is the
// accessible equivalent of every drag, so it is what's pinned here.

let seq = 0
function rec(data: Record<string, unknown>): MatchRecord {
  seq += 1
  return { match_key: `m-${seq}`, source_files: [], data } as unknown as MatchRecord
}

const RECORDS = [
  rec({ hero: 'ana', result: 'victory', map: 'rialto', eliminations: 20, deaths: 5, damage: 1000 }),
  rec({ hero: 'ana', result: 'defeat', map: 'busan', eliminations: 10, deaths: 5, damage: 500 }),
  rec({ hero: 'dva', result: 'victory', map: 'rialto', eliminations: 12, deaths: 4, damage: 3000 }),
]

// The pivot config persists; happy-dom has no global localStorage, so give
// each test a private in-memory one or the default config leaks between them.
let storage: Record<string, string>
beforeEach(() => {
  storage = {}
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage[key] ?? null,
    setItem: (key: string, value: string) => { storage[key] = value },
    removeItem: (key: string) => { delete storage[key] },
    clear: () => { storage = {} },
  })
  seedQuery(qk.system.referenceData, {
    heroes_by_role: { support: ['ana'], tank: ['dva'] },
    maps_by_game_mode: {},
    screenshot_sources: [],
    seasons: [],
  })
})
afterEach(() => vi.unstubAllGlobals())

function renderTable(records = RECORDS) {
  return render(PivotTable, { props: { records } })
}

// Each shelf is a labeled region; scoping queries to one keeps a chip
// named "Hero" apart from the crosstab column header of the same name.
const shelf = (name: string) => within(screen.getByRole('region', { name }))
const chip = (zone: string, name: string) => shelf(zone).getByRole('button', { name })

async function chooseFromChipMenu(zone: string, chipName: string, item: string) {
  await fireEvent.click(chip(zone, chipName))
  await fireEvent.click(screen.getByRole('menuitem', { name: item }))
}

const crosstab = () => within(screen.getByRole('table'))
const columnHeaders = () => crosstab().getAllByRole('columnheader').map((h) => h.textContent?.trim())
const rowHeaders = () => crosstab().getAllByRole('rowheader').map((h) => h.textContent?.trim())
const crosstabRow = (index: number) => within(crosstab().getAllByRole('row')[index]!)
// Header band 1 is the column-key groups; band 2 carries the row-field
// labels followed by the value labels repeated under every group.
const rowFieldLabels = (count: number) =>
  crosstabRow(1).getAllByRole('columnheader').slice(0, count).map((h) => h.textContent?.trim())

describe('PivotTable — default state', () => {
  it('opens on hero × result with count and win rate, and counts the set', () => {
    renderTable()
    expect(chip('Rows', 'Hero')).toBeInTheDocument()
    expect(chip('Columns', 'Result')).toBeInTheDocument()
    // A measure can sit on the Values shelf twice, so the agg badge is part
    // of each chip's name.
    expect(chip('Values', 'Matches Count')).toBeInTheDocument()
    expect(chip('Values', 'Matches Win rate')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()
    expect(screen.getByRole('table', { name: 'Pivot over 3 matches' })).toBeInTheDocument()
    expect(rowHeaders()).toEqual(['ana', 'dva', 'Total'])
  })

  it('tracks the record count through to an empty set without inventing a win rate', async () => {
    const { rerender } = renderTable([RECORDS[0]!])
    expect(screen.getByText('1 match')).toBeInTheDocument()

    await rerender({ records: [] })
    expect(screen.getByText('0 matches')).toBeInTheDocument()
    // No hero survives, so only the grand-total row remains: zero matches
    // counted, and an em-dash rather than a fabricated 0% win rate.
    expect(rowHeaders()).toEqual(['Total'])
    expect(crosstab().getAllByRole('cell').map((c) => c.textContent?.trim())).toEqual(['0', '—'])
  })
})

describe('PivotTable — keyboard-driven field moves', () => {
  it('adds a tray field to Rows, re-pivots, and announces the move', async () => {
    renderTable()
    await chooseFromChipMenu('Fields', 'Map', 'Add to Rows')

    expect(chip('Rows', 'Map')).toBeInTheDocument()
    expect(shelf('Fields').queryByRole('button', { name: 'Map' })).not.toBeInTheDocument()
    // The crosstab gains a second row-header column and nests by it.
    expect(rowHeaders()).toEqual(['ana', 'busan', 'ana', 'rialto', 'dva', 'rialto', 'Total'])
    expect(screen.getByText('Map moved to Rows')).toBeInTheDocument()
  })

  it('removes a placed dimension back to the tray and collapses its axis', async () => {
    renderTable()
    await chooseFromChipMenu('Rows', 'Hero', 'Remove')

    expect(shelf('Fields').getByRole('button', { name: 'Hero' })).toBeInTheDocument()
    // With no row dimension left the grid folds to a single All row.
    expect(rowHeaders()).toEqual(['All', 'Total'])
    expect(screen.getByText('Hero removed')).toBeInTheDocument()
  })

  it('reorders row nesting with Move up', async () => {
    renderTable()
    await chooseFromChipMenu('Fields', 'Map', 'Add to Rows')
    expect(rowFieldLabels(2)).toEqual(['Hero', 'Map'])

    await chooseFromChipMenu('Rows', 'Map', 'Move up')
    // Nesting order is the row-label header order: Map now outranks Hero,
    // and the row keys re-sort by map first.
    expect(rowFieldLabels(2)).toEqual(['Map', 'Hero'])
    expect(rowHeaders()).toEqual(['busan', 'ana', 'rialto', 'ana', 'rialto', 'dva', 'Total'])
  })

  it('restores the default layout with Reset pivot', async () => {
    renderTable()
    await chooseFromChipMenu('Rows', 'Hero', 'Move to Filters')
    expect(chip('Filters', 'Hero')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'Reset pivot' }))
    expect(chip('Rows', 'Hero')).toBeInTheDocument()
    expect(shelf('Filters').queryByRole('button', { name: 'Hero' })).not.toBeInTheDocument()
  })
})

describe('PivotTable — value shelf', () => {
  it('adds a measure from the tray with its default aggregation and a matching column', async () => {
    renderTable()
    await chooseFromChipMenu('Fields', 'Damage', 'Add to Values')

    expect(chip('Values', 'Damage Sum')).toBeInTheDocument()
    // Every column group gains the new sub-column, labeled by field + agg.
    expect(columnHeaders()).toContain('Damage (sum)')
    expect(screen.getByText('Damage moved to Values')).toBeInTheDocument()
  })

  it('re-folds the crosstab when a value spec changes aggregation', async () => {
    renderTable()
    await chooseFromChipMenu('Values', 'Matches Count', 'K/D')

    expect(chip('Values', 'Matches K/D')).toBeInTheDocument()
    expect(columnHeaders()).toContain('K/D')
    // ana's victory bucket: 20 eliminations over 5 deaths.
    const anaRow = crosstab().getAllByRole('row')[2]!
    expect(within(anaRow).getAllByRole('cell').map((c) => c.textContent?.trim()))
      .toEqual(['2.00', '0%', '4.00', '100%', '3.00', '50%'])
  })

  it('reorders the value sub-columns to match the shelf', async () => {
    renderTable()
    await chooseFromChipMenu('Values', 'Matches Win rate', 'Move up')
    // The sub-columns under every group follow the Values shelf order.
    expect(crosstabRow(1).getAllByRole('columnheader').slice(1, 3).map((h) => h.textContent?.trim()))
      .toEqual(['Win rate', 'Matches'])
  })

  it('drops a value spec and keeps the remaining one', async () => {
    renderTable()
    await chooseFromChipMenu('Values', 'Matches Count', 'Remove')

    expect(shelf('Values').queryByRole('button', { name: 'Matches Count' })).not.toBeInTheDocument()
    expect(chip('Values', 'Matches Win rate')).toBeInTheDocument()
    expect(columnHeaders()).not.toContain('Matches')
  })
})

// A real drag needs a browser (that's the e2e suite's job), but the DROP
// handler is a pure payload reader — and the live region is the only
// feedback a screen-reader user gets about whether the drag landed.
async function dropOn(zone: string, payload: unknown) {
  const raw = typeof payload === 'string' ? payload : JSON.stringify(payload)
  await fireEvent.drop(screen.getByRole('region', { name: zone }), {
    dataTransfer: { getData: () => raw },
  })
}

describe('PivotTable — drop payloads', () => {
  it('applies a dropped field the same way the menu does', async () => {
    renderTable()
    await dropOn('Rows', { fieldId: 'map', from: 'tray' })

    expect(chip('Rows', 'Map')).toBeInTheDocument()
    expect(screen.getByText('Map moved to Rows')).toBeInTheDocument()
  })

  it('removes what a drop back on the tray names, by index for a value spec', async () => {
    renderTable()
    // Two Matches chips share a field id; only the index tells them apart.
    await dropOn('Fields', { fieldId: 'matches', from: 'values', index: 0 })
    expect(shelf('Values').queryByRole('button', { name: 'Matches Count' })).not.toBeInTheDocument()
    expect(chip('Values', 'Matches Win rate')).toBeInTheDocument()
    expect(screen.getByText('Matches removed')).toBeInTheDocument()

    // A placed dimension carries no index — it just leaves its shelf.
    await dropOn('Fields', { fieldId: 'hero', from: 'rows' })
    expect(shelf('Fields').getByRole('button', { name: 'Hero' })).toBeInTheDocument()
    expect(rowHeaders()).toEqual(['All', 'Total'])
    expect(screen.getByText('Hero removed')).toBeInTheDocument()
  })

  it('stays silent on a drop it cannot apply rather than announcing a move that never happened', async () => {
    renderTable()

    // A measure has no meaning on a dimension shelf.
    await dropOn('Rows', { fieldId: 'damage', from: 'tray' })
    expect(shelf('Rows').queryByRole('button', { name: 'Damage' })).not.toBeInTheDocument()
    expect(screen.queryByText('Damage moved to Rows')).not.toBeInTheDocument()

    // …and a dimension has none on the Values shelf.
    await dropOn('Values', { fieldId: 'map', from: 'tray' })
    expect(shelf('Values').queryByRole('button', { name: 'Map' })).not.toBeInTheDocument()
    expect(screen.queryByText('Map moved to Values')).not.toBeInTheDocument()

    // Dropping a tray chip back on the tray removes nothing.
    await dropOn('Fields', { fieldId: 'map', from: 'tray' })
    expect(screen.queryByText('Map removed')).not.toBeInTheDocument()
  })

  it('ignores a drop whose payload is not a field reference', async () => {
    renderTable()
    // Dragging selected text onto a shelf must not throw or re-pivot.
    await dropOn('Rows', 'some dragged prose')
    await dropOn('Rows', { notAFieldId: 'map' })

    expect(rowHeaders()).toEqual(['ana', 'dva', 'Total'])
  })
})

describe('PivotTable — filter shelf', () => {
  async function filterByMap() {
    renderTable()
    await chooseFromChipMenu('Fields', 'Map', 'Add to Filters')
    await fireEvent.click(chip('Filters', 'Map'))
  }

  it('excludes a value from the set and reports how many of the values are shown', async () => {
    await filterByMap()
    // A freshly dropped filter constrains nothing — every value is in.
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'busan' }))
    expect(screen.getByText('1 of 2 shown')).toBeInTheDocument()
    expect(screen.getByText('2 matches')).toBeInTheDocument()
    // The excluded match was ana's only defeat, so the win-rate margin moves.
    expect(screen.getByRole('table', { name: 'Pivot over 2 matches' })).toBeInTheDocument()
    const grandRow = crosstab().getAllByRole('row').at(-1)!
    expect(within(grandRow).getAllByRole('cell').map((c) => c.textContent?.trim()))
      .toEqual(['2', '100%', '2', '100%'])

    // Re-ticking the same value puts the match back — the menu stayed open
    // through the round trip.
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'busan' }))
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()
  })

  it('re-includes every value with All', async () => {
    await filterByMap()
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'busan' }))
    expect(screen.getByText('2 matches')).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()
  })

  it('treats excluding every value as no constraint rather than an empty set', async () => {
    await filterByMap()
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'busan' }))
    await fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'rialto' }))
    // Excel-style include-by-default: an empty allow-list means "no filter",
    // so the last un-tick snaps back to the full set instead of blanking
    // the crosstab.
    expect(screen.getByText('2 of 2 shown')).toBeInTheDocument()
    expect(screen.getByText('3 matches')).toBeInTheDocument()
  })
})

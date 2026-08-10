import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import { makePivotFields } from '@/match/pivot-fields'
import { pivot, type PivotConfig } from '@/match/pivot-aggregate'
import PivotCrosstab from '@/components/matches/pivot/PivotCrosstab.vue'

// The crosstab is pure presentation over a PivotResult, so the fixtures run
// the REAL engine rather than hand-rolling a result shape — a drift in
// PivotResult breaks these tests at the seam where the render actually
// depends on it. What's pinned here is layout: which margin lands in which
// column, the sort order of the axes, and how a null vs. zero bucket reads.
const FIELDS = makePivotFields(() => 'support')

let seq = 0
function rec(data: Record<string, unknown>): MatchRecord {
  seq += 1
  return { match_key: `m-${seq}`, source_files: [], data } as unknown as MatchRecord
}

// ana wins on rialto, ana loses on busan, dva wins on rialto. dva therefore
// has NO defeat — the empty-bucket case the grid still has to render.
const RECORDS = [
  rec({ hero: 'ana', result: 'victory', map: 'rialto', damage: 1000, eliminations: 20, deaths: 5 }),
  rec({ hero: 'ana', result: 'defeat', map: 'busan', damage: 500, eliminations: 10, deaths: 5 }),
  rec({ hero: 'dva', result: 'victory', map: 'rialto', damage: 3000, eliminations: 12, deaths: 0 }),
]

const DEFAULT_CONFIG: PivotConfig = {
  rows: ['hero'],
  columns: ['result'],
  values: [{ field: 'matches', agg: 'count' }, { field: 'matches', agg: 'winRate' }],
  filters: [],
}

function renderCrosstab(config: Partial<PivotConfig> = {}, records = RECORDS) {
  const result = pivot(records, { ...DEFAULT_CONFIG, ...config }, FIELDS)
  return render(PivotCrosstab, { props: { result } })
}

const rows = () => screen.getAllByRole('row')
const cellText = (row: HTMLElement) => within(row).getAllByRole('cell').map((c) => c.textContent?.trim())
const headText = (row: HTMLElement) => within(row).getAllByRole('columnheader').map((h) => h.textContent?.trim())

describe('PivotCrosstab — grid layout', () => {
  it('lays out sorted axes, one sub-column per value spec, and the margins last', () => {
    renderCrosstab()

    // The table names itself with the filtered record count.
    expect(screen.getByRole('table', { name: 'Pivot over 3 matches' })).toBeInTheDocument()

    // Header band: the corner carries the COLUMN field label, then one group
    // per column key in sorted order, then the row-margin group.
    const [groupRow, valueRow] = rows()
    expect(headText(groupRow!)).toEqual(['Result', 'defeat', 'victory', 'Total'])
    // Second band: the ROW field label, then the value labels repeated under
    // every group — this is what keeps the colspans honest.
    expect(headText(valueRow!)).toEqual([
      'Hero',
      'Matches', 'Win rate',
      'Matches', 'Win rate',
      'Matches', 'Win rate',
    ])

    // Body rows are sorted by row key; ana's margin re-aggregates (1W/1L →
    // 50%) rather than summing the two win-rate cells.
    const anaRow = rows()[2]!
    expect(within(anaRow).getByRole('rowheader')).toHaveTextContent('ana')
    expect(cellText(anaRow)).toEqual(['1', '0%', '1', '100%', '2', '50%'])
  })

  it('renders an empty bucket as a zero count but an em-dash win rate', () => {
    renderCrosstab()
    // dva never lost: counting nothing is honestly 0, but a win rate over
    // nothing must not read as 0% — that would claim dva loses every game.
    const dvaRow = rows()[3]!
    expect(within(dvaRow).getByRole('rowheader')).toHaveTextContent('dva')
    expect(cellText(dvaRow)).toEqual(['0', '—', '1', '100%', '1', '100%'])
  })

  it('closes with a grand-total row whose margins re-aggregate the whole set', () => {
    renderCrosstab()
    const grandRow = rows().at(-1)!
    expect(within(grandRow).getByRole('rowheader')).toHaveTextContent('Total')
    // 2W/1L over the set → 67%, not the mean of the per-column rates.
    expect(cellText(grandRow)).toEqual(['1', '0%', '2', '100%', '3', '67%'])
  })
})

describe('PivotCrosstab — degenerate axes', () => {
  it('collapses to a single All group with no column margin when no column field is set', () => {
    renderCrosstab({ columns: [] })
    // Nothing to total ACROSS, so the trailing Total group is suppressed.
    expect(headText(rows()[0]!)).toEqual(['', 'All'])
    const anaRow = rows()[2]!
    expect(within(anaRow).getByRole('rowheader')).toHaveTextContent('ana')
    expect(cellText(anaRow)).toEqual(['2', '50%'])
  })

  it('labels the single row All when no row field is set', () => {
    renderCrosstab({ rows: [] })
    const onlyBodyRow = rows()[2]!
    expect(within(onlyBodyRow).getByRole('rowheader')).toHaveTextContent('All')
    expect(cellText(onlyBodyRow)).toEqual(['1', '0%', '2', '100%', '3', '67%'])
  })

  it('nests two row dimensions as two row-header columns', () => {
    renderCrosstab({ rows: ['hero', 'map'], columns: [] })
    expect(headText(rows()[1]!)).toEqual(['Hero', 'Map', 'Matches', 'Win rate'])
    // ana/busan, ana/rialto, dva/rialto — tuple-sorted left to right.
    const anaBusan = rows()[2]!
    expect(within(anaBusan).getAllByRole('rowheader').map((h) => h.textContent?.trim()))
      .toEqual(['ana', 'busan'])
    expect(cellText(anaBusan)).toEqual(['1', '0%'])
  })
})

describe('PivotCrosstab — value formatting', () => {
  it('formats each cell by its own aggregation kind', () => {
    renderCrosstab({
      columns: [],
      values: [
        { field: 'damage', agg: 'sum' },
        { field: 'damage', agg: 'avg' },
        { field: 'matches', agg: 'kd' },
      ],
    })
    // Sum stays an integer; average and K/D go to hundredths. dva's K/D
    // divides by zero deaths and falls back to the raw elimination count.
    expect(cellText(rows()[2]!)).toEqual(['1500', '750.00', '3.00'])
    expect(cellText(rows()[3]!)).toEqual(['3000', '3000.00', '12.00'])
  })

  it('falls back to Matches + Win rate when every value spec is removed', () => {
    renderCrosstab({ values: [] })
    // A crosstab with no measure columns would be a blank grid; the engine's
    // default pair keeps it readable, and the headers must say so.
    expect(headText(rows()[1]!)).toEqual([
      'Hero',
      'Matches', 'Win rate',
      'Matches', 'Win rate',
      'Matches', 'Win rate',
    ])
  })
})

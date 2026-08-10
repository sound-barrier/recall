import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'

import HeroModeHeatmap from '@/components/matches/dossier/HeroModeHeatmap.vue'

// The Hero × Game-Mode heatmap is a HYBRID surface: a plain click drills
// into the maps behind a cell, while Ctrl/⌘/Shift turns the same click
// into a spreadsheet selection that live-filters the match list. The two
// must never fire together — a drill that also narrowed (or a selection
// that also navigated away) is the failure this suite pins, along with
// the two pre-grid empty states and the combined-stats readout.

interface Cell {
  gameMode: string
  total: number
  winrate: number
  wins: number
  losses: number
  draws: number
}

// `winrate` is the DISPLAY field (already rounded upstream); `reports`
// lets a fixture hand the component a rate that disagrees with its own
// W/L, which is how the judgment-tint test proves what gets judged.
function cell(gameMode: string, wins: number, losses: number, extra: { draws?: number; reports?: number } = {}): Cell {
  const draws = extra.draws ?? 0
  const decisive = wins + losses
  return {
    gameMode,
    total: wins + losses + draws,
    wins,
    losses,
    draws,
    winrate: extra.reports ?? (decisive ? Math.round((wins / decisive) * 100) : 0),
  }
}

const COLUMNS = ['control', 'escort']
const ROWS = [
  { hero: 'lucio', cells: [cell('control', 16, 4), cell('escort', 0, 0)] },
  { hero: 'ana', cells: [cell('control', 5, 12), cell('escort', 8, 8, { draws: 2 })] },
]

// A capitalizing label so the tests can tell the raw slug (the wire key)
// apart from the display name in every accessible label.
const heroLabel = (h: string) => h.charAt(0).toUpperCase() + h.slice(1)

interface RenderOptions {
  rows?: typeof ROWS
  columnHeaders?: string[]
  belowFloor?: boolean
  minMatches?: number
  decisiveTotal?: number
}

function renderHeatmap(opts: RenderOptions = {}) {
  const rows = opts.rows ?? ROWS
  return render(HeroModeHeatmap, {
    props: {
      rows,
      columnHeaders: opts.columnHeaders ?? COLUMNS,
      belowFloor: opts.belowFloor ?? false,
      minMatches: opts.minMatches ?? 15,
      decisiveTotal: opts.decisiveTotal ?? 45,
      heroLabel,
    },
  })
}

const grid = () => screen.getByRole('grid')
const cellByName = (name: RegExp) => screen.getByRole('gridcell', { name })
const lucioControl = () => cellByName(/^Lucio on control: 80% winrate/)
const anaEscort = () => cellByName(/^Ana on escort: 50% winrate/)
const readout = () => screen.getByText(/plain click drills in|cells?/)

describe('HeroModeHeatmap — pre-grid states', () => {
  it('asks for a first match rather than quoting a floor when nothing is played', () => {
    renderHeatmap({ decisiveTotal: 0, belowFloor: true })
    expect(screen.getByText('At least 1 match must be played to display data.')).toBeInTheDocument()
    expect(screen.queryByText(/decisive matches in this window/)).not.toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('quotes the floor AND the shortfall when there is data but not enough', () => {
    renderHeatmap({ belowFloor: true, minMatches: 15, decisiveTotal: 9 })
    expect(screen.getByText(/Need 15\+ decisive matches in this window/)).toBeInTheDocument()
    expect(screen.getByText(/You have 9\./)).toBeInTheDocument()
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })
})

describe('HeroModeHeatmap — grid labeling', () => {
  it('sizes its own accessible name from the rendered dimensions', () => {
    renderHeatmap()
    expect(screen.getByRole('grid', { name: /2 heroes × 2 game modes/ })).toBeInTheDocument()
  })

  it('runs hero slugs through heroLabel for headers and cells alike', () => {
    renderHeatmap()
    expect(screen.getByRole('rowheader', { name: 'Select all game modes for Lucio' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Select all heroes on control' })).toBeInTheDocument()
    expect(lucioControl()).toBeInTheDocument()
  })

  it('marks an unplayed cell as such and makes it unclickable', () => {
    renderHeatmap()
    const empty = screen.getByRole('gridcell', { name: 'Lucio on escort: no matches' })
    expect(empty).toBeDisabled()
    expect(empty).toHaveTextContent('')
  })

  it('judges the tint from the raw W/L, never the pre-rounded winrate field', () => {
    // 7-8 is a 47% slide, but the cell arrives claiming 60 and — at 15
    // decisive — sits exactly ON the volume floor, so it must be judged,
    // not greyed. A regression that fed `cell.winrate` to the judgment
    // would paint this green.
    renderHeatmap({
      rows: [{ hero: 'lucio', cells: [cell('control', 7, 8, { reports: 60 }), cell('escort', 0, 0)] }],
      columnHeaders: COLUMNS,
    })
    const judged = screen.getByRole('gridcell', { name: /^Lucio on control: 60% winrate over 15 matches/ })
    // eslint-disable-next-line no-restricted-syntax -- heatmap judgment tint: the win-rate band is carried by the class alone, no ARIA or text expresses it
    expect(judged).toHaveClass('cell-loss')
  })
})

describe('HeroModeHeatmap — plain click drills, modified click selects', () => {
  it('a plain click emits the drill target and selects nothing', async () => {
    const { emitted } = renderHeatmap()
    await fireEvent.click(lucioControl())

    expect(emitted().cell).toEqual([['lucio', 'control']])
    expect(lucioControl()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/plain click drills in/)).toBeInTheDocument()
  })

  it('Enter and Space drill too, so the grid is reachable without a mouse', async () => {
    const { emitted } = renderHeatmap()
    await fireEvent.keyDown(lucioControl(), { key: 'Enter' })
    await fireEvent.keyDown(anaEscort(), { key: ' ', code: 'Space' })

    expect(emitted().cell).toEqual([['lucio', 'control'], ['ana', 'escort']])
  })

  it('a Ctrl-click selects instead of drilling and pushes the hull up as a filter', async () => {
    const { emitted } = renderHeatmap()
    await fireEvent.click(lucioControl(), { ctrlKey: true })

    expect(emitted().cell).toBeUndefined()
    expect(lucioControl()).toHaveAttribute('aria-pressed', 'true')
    expect(emitted().filter?.at(-1)).toEqual([{ heroes: ['lucio'], gameModes: ['control'] }])
  })

  it('⌘-click selects too — Mac users never press Ctrl', async () => {
    const { emitted } = renderHeatmap()
    await fireEvent.click(lucioControl(), { metaKey: true })

    expect(emitted().cell).toBeUndefined()
    expect(lucioControl()).toHaveAttribute('aria-pressed', 'true')
  })
})

describe('HeroModeHeatmap — selection readout', () => {
  it('sums W/L/D and win rate across the selected cells', async () => {
    renderHeatmap()
    await fireEvent.click(lucioControl(), { ctrlKey: true })
    expect(readout()).toHaveTextContent('1 cell · 16–4–0 · 80% WR · 20 games')

    await fireEvent.click(anaEscort(), { ctrlKey: true })
    // 24-12 decisive → 67%; 20 + 18 games.
    expect(readout()).toHaveTextContent('2 cells · 24–12–2 · 67% WR · 38 games')
  })

  it('omits the win rate rather than printing 0% for an all-draw selection', async () => {
    renderHeatmap({
      rows: [{ hero: 'mercy', cells: [cell('control', 0, 0, { draws: 1 }), cell('escort', 0, 0)] }],
    })
    await fireEvent.click(screen.getByRole('gridcell', { name: /^Mercy on control/ }), { ctrlKey: true })
    expect(readout()).toHaveTextContent('1 cell · 0–0–1 · 1 game')
    expect(readout()).not.toHaveTextContent('WR')
  })

  it('warns that a ragged selection filters its whole rectangular hull', async () => {
    renderHeatmap()
    await fireEvent.click(lucioControl(), { ctrlKey: true })
    expect(screen.queryByText(/filtering every hero × mode/)).not.toBeInTheDocument()

    // lucio×control + ana×escort spans a 2×2 hull with only 2 cells picked.
    await fireEvent.click(anaEscort(), { ctrlKey: true })
    expect(screen.getByText(/filtering every hero × mode in your selection/)).toBeInTheDocument()
  })
})

describe('HeroModeHeatmap — header selection', () => {
  it('a column header selects that mode for every hero and lights both dimensions', async () => {
    renderHeatmap()
    const control = screen.getByRole('columnheader', { name: 'Select all heroes on control' })
    await fireEvent.click(control)

    expect(control).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('rowheader', { name: 'Select all game modes for Lucio' }))
      .toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('rowheader', { name: 'Select all game modes for Ana' }))
      .toHaveAttribute('aria-pressed', 'true')
    // A whole column IS its own hull, so no ragged-selection warning.
    expect(readout()).toHaveTextContent('2 cells · 21–16–0')
    expect(screen.queryByText(/filtering every hero × mode/)).not.toBeInTheDocument()
  })

  it('a row header skips the hero\'s unplayed cells', async () => {
    renderHeatmap()
    await fireEvent.click(screen.getByRole('rowheader', { name: 'Select all game modes for Lucio' }))
    // lucio has one played cell (control) and one empty (escort).
    expect(readout()).toHaveTextContent('1 cell · 16–4–0')
  })
})

describe('HeroModeHeatmap — clearing the selection', () => {
  it('Escape drops the selection and re-emits an empty filter', async () => {
    const { emitted } = renderHeatmap()
    await fireEvent.click(lucioControl(), { ctrlKey: true })

    await fireEvent.keyDown(grid(), { key: 'Escape' })

    expect(lucioControl()).toHaveAttribute('aria-pressed', 'false')
    expect(emitted().filter?.at(-1)).toEqual([{ heroes: [], gameModes: [] }])
    expect(screen.getByText(/plain click drills in/)).toBeInTheDocument()
  })

  it('a mousedown on the grid background clears it too', async () => {
    renderHeatmap()
    await fireEvent.click(lucioControl(), { ctrlKey: true })
    expect(lucioControl()).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.mouseDown(grid())
    expect(lucioControl()).toHaveAttribute('aria-pressed', 'false')
  })
})

import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, type RenderResult } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import MatchHeatmapHeader from '@/components/matches/timeline/MatchHeatmapHeader.vue'

// Days are keyed relative to today so they fall inside the heatmap's trailing
// window regardless of the wall-clock date the suite runs on.
function ymd(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

// The human date each day cell puts at the head of its accessible name.
function human(offset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

const records = [
  { match_key: 'm1', source_files: ['m1.png'], data: { date: ymd(-3), result: 'victory' } },
] as unknown as MatchRecord[]

// Each day cell is a toggle button that names itself with its date, so the
// highlighted span reads off aria-pressed. The month labels are buttons on
// the same grid — drop them by their "Filter to <month>" name.
function activeDays(): string[] {
  return screen.queryAllByRole('button', { pressed: true })
    .map((c) => c.getAttribute('aria-label') ?? '')
    .filter((name) => !name.startsWith('Filter to '))
    .map((name) => name.split(' — ')[0] ?? '')
}

// The month labels the component draws — hardcoded English in the composable,
// so the expectation must not go through toLocaleDateString (which follows the
// runner's locale).
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function dayCell(offset: number): HTMLElement {
  return screen.getByRole('button', { name: new RegExp(`^${human(offset)} — `) })
}

function emittedRange(view: RenderResult): [unknown, unknown] {
  return [view.emitted()['update:filter-from'], view.emitted()['update:filter-to']]
}

// The calendar names itself with the window it covers.
function windowStart(): string {
  const label = screen.getByRole('group', { name: /^Match calendar/ }).getAttribute('aria-label') ?? ''
  return label.match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? ''
}

function renderHeatmap(props: Record<string, unknown> = {}): RenderResult {
  return render(MatchHeatmapHeader, {
    props: { records, filterFrom: '', filterTo: '', windowWeeks: 26, ...props },
  })
}

describe('MatchHeatmapHeader — season highlight', () => {
  it('lights the picked-season day span when no manual range is set', () => {
    render(MatchHeatmapHeader, {
      props: { records, filterFrom: '', filterTo: '', seasonFrom: ymd(-5), seasonTo: ymd(2), windowWeeks: 26 },
    })
    const active = activeDays()
    expect(active.length).toBeGreaterThan(1)
    expect(active).toContain(human(-3)) // inside the span
    expect(active).not.toContain(human(-20)) // outside the span, still in-grid
  })

  it('lets a manual date range take precedence over the season overlay', () => {
    render(MatchHeatmapHeader, {
      props: {
        records,
        filterFrom: `${ymd(-3)}T00:00`, filterTo: `${ymd(-3)}T23:59`,
        seasonFrom: ymd(-5), seasonTo: ymd(2),
        windowWeeks: 26,
      },
    })
    // Only the manually-picked single day is active — the wider season is ignored.
    expect(activeDays()).toEqual([human(-3)])
  })

  it('shows no highlight with neither a range nor a season', () => {
    render(MatchHeatmapHeader, {
      props: { records, filterFrom: '', filterTo: '', seasonFrom: '', seasonTo: '', windowWeeks: 26 },
    })
    expect(activeDays()).toEqual([])
  })
})

describe('MatchHeatmapHeader — what a day cell says', () => {
  it('reports the day record and pluralizes draws, with draws out of the win rate', () => {
    renderHeatmap({
      records: [
        { match_key: 'a', source_files: ['a.png'], data: { date: ymd(-2), result: 'victory' } },
        { match_key: 'b', source_files: ['b.png'], data: { date: ymd(-2), result: 'draw' } },
        { match_key: 'c', source_files: ['c.png'], data: { date: ymd(-4), result: 'victory' } },
        { match_key: 'd', source_files: ['d.png'], data: { date: ymd(-4), result: 'defeat' } },
        { match_key: 'e', source_files: ['e.png'], data: { date: ymd(-4), result: 'draw' } },
        { match_key: 'f', source_files: ['f.png'], data: { date: ymd(-4), result: 'draw' } },
      ] as unknown as MatchRecord[],
    })

    // One draw stays singular and never dilutes the 100%.
    expect(dayCell(-2)).toHaveAccessibleName(`${human(-2)} — 1 wins, 0 losses, 1 draw, 100% win rate`)
    expect(dayCell(-4)).toHaveAccessibleName(`${human(-4)} — 1 wins, 1 losses, 2 draws, 50% win rate`)
    expect(dayCell(-3)).toHaveAccessibleName(`${human(-3)} — no matches`)
  })
})

describe('MatchHeatmapHeader — the week start', () => {
  // Every column has to be a whole week, so the window snaps back to the
  // preferred first day rather than starting mid-week.
  it('snaps the grid to the preferred first day of the week', () => {
    const { unmount } = renderHeatmap({ weekStartsOn: 0 })
    expect(new Date(`${windowStart()}T00:00`).getDay()).toBe(0)
    unmount()

    renderHeatmap({ weekStartsOn: 1 })
    expect(new Date(`${windowStart()}T00:00`).getDay()).toBe(1)
  })
})

describe('MatchHeatmapHeader — picking days', () => {
  it('picks a single day as a whole-day range', async () => {
    const view = renderHeatmap()

    await fireEvent.keyDown(dayCell(-3), { key: 'Enter' })

    expect(emittedRange(view)).toEqual([[[`${ymd(-3)}T00:00`]], [[`${ymd(-3)}T23:59`]]])
  })

  it('toggles the active single day back off when it is picked again', async () => {
    const view = renderHeatmap({ filterFrom: `${ymd(-3)}T00:00`, filterTo: `${ymd(-3)}T23:59` })

    await fireEvent.keyDown(dayCell(-3), { key: 'Enter' })

    expect(emittedRange(view)).toEqual([[['']], [['']]])
  })

  it('clears the range when an empty day is clicked — the "cancel the box" gesture', async () => {
    const view = renderHeatmap({ filterFrom: `${ymd(-3)}T00:00`, filterTo: `${ymd(-3)}T23:59` })
    const empty = dayCell(-10)

    await fireEvent.mouseDown(empty, { clientX: 0, clientY: 0 })
    await fireEvent.mouseUp(window, { clientX: 0, clientY: 0 })

    expect(emittedRange(view)).toEqual([[['']], [['']]])
  })

  it('extends the active range to the shift-picked day, whichever side it lands on', async () => {
    const view = renderHeatmap({ filterFrom: `${ymd(-5)}T00:00`, filterTo: `${ymd(-5)}T23:59` })

    await fireEvent.keyDown(dayCell(-1), { key: 'Enter', shiftKey: true })
    await fireEvent.keyDown(dayCell(-9), { key: 'Enter', shiftKey: true })

    // Both extensions anchor on the range's start; the earlier day flips the
    // pair so the emitted range always reads from → to.
    expect(view.emitted()['update:filter-from']).toEqual([[`${ymd(-5)}T00:00`], [`${ymd(-9)}T00:00`]])
    expect(view.emitted()['update:filter-to']).toEqual([[`${ymd(-1)}T23:59`], [`${ymd(-5)}T23:59`]])
  })

  // Both grids are role="button" elements rather than real buttons, so the two
  // activation keys are wired by hand and have to keep working.
  it('activates a day with Space and a month with Enter, like any other button', async () => {
    const view = renderHeatmap()
    const past = new Date()
    past.setDate(past.getDate() - 45)
    const monthName = `Filter to ${MONTH_ABBR[past.getMonth()]} ${past.getFullYear()}`

    await fireEvent.keyDown(dayCell(-3), { key: ' ' })
    await fireEvent.keyDown(screen.getByRole('button', { name: monthName }), { key: 'Enter' })

    expect(view.emitted()['update:filter-from']).toEqual([
      [`${ymd(-3)}T00:00`],
      [`${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}-01T00:00`],
    ])
  })

  it('anchors a shift-pick on the day itself when no range is active', async () => {
    const view = renderHeatmap()

    await fireEvent.keyDown(dayCell(-6), { key: 'Enter', shiftKey: true })

    expect(emittedRange(view)).toEqual([[[`${ymd(-6)}T00:00`]], [[`${ymd(-6)}T23:59`]]])
  })
})

describe('MatchHeatmapHeader — picking a month', () => {
  // A month fully inside the 26-week window, so its label always has a
  // first-row anchor cell regardless of today's date.
  const past = new Date()
  past.setDate(past.getDate() - 45)
  const monthKey = `${past.getFullYear()}-${String(past.getMonth() + 1).padStart(2, '0')}`
  const monthName = `Filter to ${MONTH_ABBR[past.getMonth()]} ${past.getFullYear()}`
  const lastDay = String(new Date(past.getFullYear(), past.getMonth() + 1, 0).getDate())

  it('picks the whole calendar month, first day to last', async () => {
    const view = renderHeatmap()

    await fireEvent.click(screen.getByRole('button', { name: monthName }))

    expect(emittedRange(view)).toEqual([
      [[`${monthKey}-01T00:00`]],
      [[`${monthKey}-${lastDay}T23:59`]],
    ])
  })

  it('reads as pressed once its span is the active range, and toggles off', async () => {
    const view = renderHeatmap({
      filterFrom: `${monthKey}-01T00:00`,
      filterTo: `${monthKey}-${lastDay}T23:59`,
    })
    const month = screen.getByRole('button', { name: monthName })
    expect(month).toHaveAttribute('aria-pressed', 'true')

    await fireEvent.keyDown(month, { key: ' ' })

    expect(emittedRange(view)).toEqual([[['']], [['']]])
  })

  it('leaves the month unpressed when only part of it is selected', () => {
    renderHeatmap({ filterFrom: `${monthKey}-01T00:00`, filterTo: `${monthKey}-02T23:59` })

    expect(screen.getByRole('button', { name: monthName })).toHaveAttribute('aria-pressed', 'false')
  })
})

// Drag-select maps pointer coordinates through the SVG's box, which happy-dom
// never lays out (every rect is zeros, and the component bails on a zero-sized
// box). Stubbing the box to the SVG's own width/height attributes makes client
// coordinates equal user-space coordinates, so a cell's x/y attributes address
// it exactly.
describe('MatchHeatmapHeader — dragging out a range', () => {
  afterEach(() => vi.restoreAllMocks())

  function stubSvgBox(): void {
    vi.spyOn(SVGElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return {
        left: 0, top: 0,
        width: Number(this.getAttribute('width') ?? 0),
        height: Number(this.getAttribute('height') ?? 0),
      } as DOMRect
    })
  }

  // The middle of a cell, in the SVG user space the stub above makes 1:1.
  function centerOf(cell: HTMLElement): { clientX: number; clientY: number } {
    const half = Number(cell.getAttribute('width') ?? 0) / 2
    return {
      clientX: Number(cell.getAttribute('x') ?? 0) + half,
      clientY: Number(cell.getAttribute('y') ?? 0) + half,
    }
  }

  it('selects every day between the anchor and the release, even diagonally', async () => {
    stubSvgBox()
    const view = renderHeatmap()

    // −9 and −3 sit on different rows AND different week columns, so the span
    // is a date range, not the grid rectangle between them.
    await fireEvent.mouseDown(dayCell(-9), centerOf(dayCell(-9)))
    await fireEvent.mouseMove(window, centerOf(dayCell(-3)))
    await fireEvent.mouseUp(window, centerOf(dayCell(-3)))

    expect(emittedRange(view)).toEqual([[[`${ymd(-9)}T00:00`]], [[`${ymd(-3)}T23:59`]]])
  })

  it('previews the whole span while the drag is still in flight', async () => {
    stubSvgBox()
    renderHeatmap()

    await fireEvent.mouseDown(dayCell(-9), centerOf(dayCell(-9)))
    await fireEvent.mouseMove(window, centerOf(dayCell(-6)))

    expect(activeDays()).toEqual([human(-9), human(-8), human(-7), human(-6)])
  })

  it('normalizes a backwards drag into an ascending range', async () => {
    stubSvgBox()
    const view = renderHeatmap()

    await fireEvent.mouseDown(dayCell(-2), centerOf(dayCell(-2)))
    await fireEvent.mouseMove(window, centerOf(dayCell(-8)))
    await fireEvent.mouseUp(window, centerOf(dayCell(-8)))

    expect(emittedRange(view)).toEqual([[[`${ymd(-8)}T00:00`]], [[`${ymd(-2)}T23:59`]]])
  })

  it('extends the range from a shift-press instead of starting a new drag', async () => {
    stubSvgBox()
    const view = renderHeatmap({ filterFrom: `${ymd(-5)}T00:00`, filterTo: `${ymd(-5)}T23:59` })

    await fireEvent.mouseDown(dayCell(-1), { ...centerOf(dayCell(-1)), shiftKey: true })
    // No drag was armed, so the release is inert.
    await fireEvent.mouseUp(window, centerOf(dayCell(-1)))

    expect(emittedRange(view)).toEqual([[[`${ymd(-5)}T00:00`]], [[`${ymd(-1)}T23:59`]]])
  })

  it('keeps the last day under the cursor when the drag wanders off the grid', async () => {
    stubSvgBox()
    const view = renderHeatmap()

    await fireEvent.mouseDown(dayCell(-9), centerOf(dayCell(-9)))
    await fireEvent.mouseMove(window, centerOf(dayCell(-6)))
    // Into the weekday-label gutter, left of column zero.
    await fireEvent.mouseMove(window, { clientX: 2, clientY: 2 })
    await fireEvent.mouseUp(window, { clientX: 2, clientY: 2 })

    expect(emittedRange(view)).toEqual([[[`${ymd(-9)}T00:00`]], [[`${ymd(-6)}T23:59`]]])
  })

  it('treats a press and release on one day as a single-day pick', async () => {
    stubSvgBox()
    const view = renderHeatmap()

    await fireEvent.mouseDown(dayCell(-3), centerOf(dayCell(-3)))
    await fireEvent.mouseUp(window, centerOf(dayCell(-3)))

    expect(emittedRange(view)).toEqual([[[`${ymd(-3)}T00:00`]], [[`${ymd(-3)}T23:59`]]])
  })

  it('stops listening on the window when it unmounts mid-gesture', async () => {
    stubSvgBox()
    const view = renderHeatmap()

    await fireEvent.mouseDown(dayCell(-9), centerOf(dayCell(-9)))
    view.unmount()
    await fireEvent.mouseMove(window, { clientX: 200, clientY: 60 })
    await fireEvent.mouseUp(window, { clientX: 200, clientY: 60 })

    expect(emittedRange(view)).toEqual([undefined, undefined])
  })
})

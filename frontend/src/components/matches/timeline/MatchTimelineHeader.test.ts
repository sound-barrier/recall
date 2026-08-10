import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent, type RenderResult } from '@testing-library/vue'

import type { MatchRecord } from '@/api-client'
import MatchTimelineHeader from '@/components/matches/timeline/MatchTimelineHeader.vue'

// Dates are built from LOCAL components and keyed to today: a toISOString()
// "today" lands on the previous day west of UTC, and a hard-coded date rolls
// off the trailing window the Campaign Log draws.
function ymd(dayOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function human(dayOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function match(date: string, result: string, key: string): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data: { date, result } } as unknown as MatchRecord
}

const week = [
  match(ymd(-2), 'victory', 'a'),
  match(ymd(-2), 'victory', 'b'),
  match(ymd(-2), 'defeat', 'c'),
  match(ymd(-1), 'draw', 'd'),
  match(ymd(-30), 'victory', 'e'),
]

function renderTimeline(props: Record<string, unknown> = {}): RenderResult {
  return render(MatchTimelineHeader, {
    props: { records: week, filterFrom: '', filterTo: '', ...props },
  })
}

// Both vizzes name themselves with the window they cover; this pulls the two
// dates back out so a test can compare them.
function windowOf(name: string): string[] {
  return name.match(/\d{4}-\d{2}-\d{2}/g) ?? []
}

function calendarWindow(): string[] {
  return windowOf(screen.getByRole('group', { name: /^Match calendar/ }).getAttribute('aria-label') ?? '')
}

function sparklineWindow(): string[] {
  return windowOf(screen.getByRole('img', { name: /^Match volume/ }).getAttribute('aria-label') ?? '')
}

describe('MatchTimelineHeader — the empty shell', () => {
  it('says a match is needed and draws neither viz when the set is empty', () => {
    renderTimeline({ records: [] })

    expect(screen.getByText('At least 1 match must be played to display data.')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: /^Match calendar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('img', { name: /^Match volume/ })).not.toBeInTheDocument()
    // No range prompt either — there is nothing to select on.
    expect(screen.queryByText(/Click a day, drag a range/)).not.toBeInTheDocument()
  })

  it('prompts for a selection once there is something to select', () => {
    renderTimeline()

    expect(screen.getByText(/Click a day, drag a range, or pick a month/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reset/ })).not.toBeInTheDocument()
  })
})

// The readout interleaves a <strong> count with plain text, so it reads off
// the band as a whole rather than through a single text node.
function band(): HTMLElement {
  return screen.getByRole('region', { name: 'Campaign Log' })
}

describe('MatchTimelineHeader — the selection readout', () => {
  it('totals the selected days, record, win rate and games', () => {
    renderTimeline({ filterFrom: `${ymd(-2)}T00:00`, filterTo: `${ymd(-1)}T23:59` })

    // The draw counts as a game and a day but stays out of the win rate.
    expect(band()).toHaveTextContent(/2 days · 2–1–1 · 67% WR · 4 games/)
  })

  it('drops the win rate and singularizes when the only day was drawn', () => {
    renderTimeline({ filterFrom: `${ymd(-1)}T00:00`, filterTo: `${ymd(-1)}T23:59` })

    expect(band()).toHaveTextContent(/1 day · 0–0–1 · 1 game/)
    expect(band()).not.toHaveTextContent('WR')
  })

  it('treats a missing bound as open-ended', () => {
    renderTimeline({ filterFrom: `${ymd(-2)}T00:00`, filterTo: '' })

    // Everything from that day forward: the two days of this week, not the
    // month-old match.
    expect(band()).toHaveTextContent(/2 days · 2–1–1 · 67% WR · 4 games/)
  })
})

describe('MatchTimelineHeader — clearing the range', () => {
  it('offers Reset only while a range is set, and clears both bounds', async () => {
    const view = renderTimeline({ filterFrom: `${ymd(-2)}T00:00`, filterTo: `${ymd(-1)}T23:59` })

    await fireEvent.click(screen.getByRole('button', { name: /Reset/ }))

    expect(view.emitted()['update:filter-from']).toEqual([['']])
    expect(view.emitted()['update:filter-to']).toEqual([['']])
  })

  it('forwards a range brushed on the sparkline', async () => {
    const view = renderTimeline()
    const [windowStart, windowEnd] = calendarWindow()
    const firstBar = screen.getAllByRole('img')[1]!

    await fireEvent.pointerDown(firstBar, { clientX: -5000, clientY: 40, button: 0 })
    await fireEvent.pointerMove(firstBar, { clientX: 5000, clientY: 40 })
    await fireEvent.pointerUp(firstBar, { clientX: 5000, clientY: 40 })

    expect(view.emitted()['update:filter-from']).toEqual([[`${windowStart}T00:00`]])
    expect(view.emitted()['update:filter-to']).toEqual([[`${windowEnd}T23:59`]])
  })

  it('forwards a day picked on the calendar as its own range update', async () => {
    const view = renderTimeline()

    await fireEvent.keyDown(
      screen.getByRole('button', { name: new RegExp(`^${human(-2)} — `) }),
      { key: 'Enter' },
    )

    expect(view.emitted()['update:filter-from']).toEqual([[`${ymd(-2)}T00:00`]])
    expect(view.emitted()['update:filter-to']).toEqual([[`${ymd(-2)}T23:59`]])
  })
})

describe('MatchTimelineHeader — the window picker', () => {
  it('keeps both vizzes on the same window', () => {
    renderTimeline()

    expect(screen.getByRole('button', { name: '6M' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Last 6 months')).toBeInTheDocument()
    expect(calendarWindow()).toEqual(sparklineWindow())
  })

  it('reaches further back at every step up, always ending today', async () => {
    renderTimeline()
    const starts: string[] = []

    for (const months of [1, 3, 6, 12]) {
      await fireEvent.click(screen.getByRole('button', { name: `${months}M` }))
      const [start, end] = calendarWindow()
      starts.push(start ?? '')
      expect(screen.getByRole('button', { name: `${months}M` })).toHaveAttribute('aria-pressed', 'true')
      expect(end).toBe(ymd(0))
      expect(calendarWindow()).toEqual(sparklineWindow())
    }

    expect(starts).toEqual([...starts].sort().reverse())
    expect(new Set(starts).size).toBe(4)
  })

  it('singularizes the one-month window', async () => {
    renderTimeline()

    await fireEvent.click(screen.getByRole('button', { name: '1M' }))

    expect(screen.getByText('Last 1 month')).toBeInTheDocument()
  })
})

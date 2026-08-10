import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'

import type { MatchRecord } from '@/api-client'
import MatchSparklineBrush from '@/components/matches/timeline/MatchSparklineBrush.vue'

// Every fixture date is built from LOCAL calendar components — a
// toISOString()-derived "today" lands on the wrong day west of UTC, and a
// hard-coded date rolls off the trailing window and leaves the grid empty.
function ymd(dayOffset: number): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function match(date: string, result: string, key: string): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data: { date, result } } as unknown as MatchRecord
}

// The bars are `role="img"` with a date-led accessible name; so is the host
// container, which sorts first in document order — drop it and what's left is
// the day columns, oldest → newest.
function barNames(): string[] {
  return screen.getAllByRole('img').slice(1).map((bar) => bar.getAttribute('aria-label') ?? '')
}

function renderBrush(props: Record<string, unknown> = {}) {
  return render(MatchSparklineBrush, {
    props: { records: [], filterFrom: '', filterTo: '', windowWeeks: 26, ...props },
  })
}

// A brush gesture across the strip. Pixel coordinates are deliberately far
// outside the plot so xToIndex's clamp resolves them to the first / last bar
// regardless of how wide happy-dom thinks the (unlaid-out) SVG is.
const FAR_LEFT = -5_000
const FAR_RIGHT = 5_000

async function brush(from: number, to: number): Promise<void> {
  const bar = screen.getAllByRole('img')[1]!
  await fireEvent.pointerDown(bar, { clientX: from, clientY: 40, button: 0 })
  await fireEvent.pointerMove(bar, { clientX: to, clientY: 40 })
  await fireEvent.pointerUp(bar, { clientX: to, clientY: 40 })
}

function dayOf(label: string): string {
  return label.split(' — ')[0] ?? ''
}

describe('MatchSparklineBrush — the day columns', () => {
  it('runs one bar per day, oldest first, ending on today', () => {
    renderBrush({ records: [match(ymd(-1), 'victory', 'm1')] })
    const days = barNames().map(dayOf)

    // 26 weeks, plus the days between the week-start snap and today.
    expect(days.length).toBeGreaterThanOrEqual(26 * 7)
    expect(days.at(-1)).toBe(ymd(0))
    expect(days).toEqual([...days].sort())
  })

  it('names each day with its volume and record, and says so when a day is empty', () => {
    renderBrush({
      records: [
        match(ymd(-1), 'victory', 'm1'),
        match(ymd(-2), 'victory', 'm2'),
        match(ymd(-2), 'defeat', 'm3'),
      ],
    })

    expect(screen.getByRole('img', { name: `${ymd(-1)} — 1 match (1W 0L)` })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `${ymd(-2)} — 2 matches (1W 1L)` })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: `${ymd(-3)} — no matches` })).toBeInTheDocument()
  })
})

describe('MatchSparklineBrush — the brush gesture', () => {
  it('drags a range and emits the spanned days as whole-day bounds', async () => {
    const view = renderBrush({ records: [match(ymd(-1), 'victory', 'm1')] })
    const names = barNames()

    await brush(FAR_LEFT, FAR_RIGHT)

    expect(view.emitted()['update:filter-from']).toEqual([[`${dayOf(names[0] ?? '')}T00:00`]])
    expect(view.emitted()['update:filter-to']).toEqual([[`${dayOf(names.at(-1) ?? '')}T23:59`]])
  })

  it('normalizes a right-to-left drag into an ascending range', async () => {
    const view = renderBrush()
    const names = barNames()

    await brush(FAR_RIGHT, FAR_LEFT)

    expect(view.emitted()['update:filter-from']).toEqual([[`${dayOf(names[0] ?? '')}T00:00`]])
    expect(view.emitted()['update:filter-to']).toEqual([[`${dayOf(names.at(-1) ?? '')}T23:59`]])
  })

  it('clears the filter on a plain click — press and release with no movement', async () => {
    const view = renderBrush({ filterFrom: `${ymd(-5)}T00:00`, filterTo: `${ymd(-1)}T23:59` })
    const bar = screen.getAllByRole('img')[1]!

    await fireEvent.pointerDown(bar, { clientX: FAR_RIGHT, clientY: 40, button: 0 })
    await fireEvent.pointerUp(bar, { clientX: FAR_RIGHT, clientY: 40 })

    expect(view.emitted()['update:filter-from']).toEqual([['']])
    expect(view.emitted()['update:filter-to']).toEqual([['']])
  })

  it('ignores a non-primary button, and a hover with no button down', async () => {
    const view = renderBrush()
    const bar = screen.getAllByRole('img')[1]!

    await fireEvent.pointerDown(bar, { clientX: FAR_LEFT, clientY: 40, button: 2 })
    await fireEvent.pointerMove(bar, { clientX: FAR_RIGHT, clientY: 40 })
    await fireEvent.pointerUp(bar, { clientX: FAR_RIGHT, clientY: 40 })

    expect(view.emitted()['update:filter-from']).toBeUndefined()
    expect(view.emitted()['update:filter-to']).toBeUndefined()
  })
})

describe('MatchSparklineBrush — following its container', () => {
  // The SVG's width attribute is synced to the host box by a ResizeObserver so
  // viewport and viewBox coordinates stay 1:1 — the brush math depends on it.
  // happy-dom lays nothing out, so the observer is driven by hand.
  it('re-scales the bars when the container grows, so the brush still hits the day under the cursor', async () => {
    const observers: ((entries: { contentRect: { width: number } }[]) => void)[] = []
    class StubResizeObserver {
      constructor(cb: (entries: { contentRect: { width: number } }[]) => void) { observers.push(cb) }
      observe(): void { /* geometry is delivered by the test */ }
      disconnect(): void { /* no-op */ }
    }
    vi.stubGlobal('ResizeObserver', StubResizeObserver)

    const { emitted: atDefaultWidth, unmount } = renderBrush()
    await brush(100, FAR_RIGHT)
    const beforeWiden = atDefaultWidth()['update:filter-from']?.[0]
    unmount()

    const { emitted: afterResize } = renderBrush()
    observers.at(-1)?.([{ contentRect: { width: 1840 } }])
    // A hidden container reports zero — keep the last real width rather than
    // collapsing every bar onto the same pixel.
    observers.at(-1)?.([{ contentRect: { width: 0 } }])
    await nextTick()
    await brush(100, FAR_RIGHT)
    const afterWiden = afterResize()['update:filter-from']?.[0]

    // Same cursor position, four times the width: the bars are wider, so the
    // pointer now lands on a much earlier day.
    expect(String(afterWiden)).not.toBe(String(beforeWiden))
    expect(String(afterWiden) < String(beforeWiden)).toBe(true)

    vi.unstubAllGlobals()
  })
})

describe('MatchSparklineBrush — the window', () => {
  it('narrows the strip to the picked window', () => {
    const { unmount } = renderBrush({ windowWeeks: 13 })
    const quarter = barNames()
    unmount()

    renderBrush({ windowWeeks: 52 })
    const year = barNames()

    expect(quarter.length).toBeGreaterThanOrEqual(13 * 7)
    expect(year.length).toBeGreaterThan(quarter.length + 200)
    expect(dayOf(quarter.at(-1) ?? '')).toBe(dayOf(year.at(-1) ?? ''))
  })
})

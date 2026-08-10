import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'

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

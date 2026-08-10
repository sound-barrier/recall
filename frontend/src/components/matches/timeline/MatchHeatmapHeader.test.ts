import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/vue'

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

const records = [
  { match_key: 'm1', source_files: ['m1.png'], data: { date: ymd(-3), result: 'victory' } },
] as unknown as MatchRecord[]

function activeDates(baseElement: Element): string[] {
  // SVG heatmap cells expose their highlight state only through the
  // `active` class + data-date identity (the same contract the e2e
  // specs select on) — rects carry no queryable role.
  return [...baseElement.querySelectorAll('.heatmap-cell.active')].map((c) => c.getAttribute('data-date') ?? '')
}

describe('MatchHeatmapHeader — season highlight', () => {
  it('lights the picked-season day span when no manual range is set', () => {
    const { baseElement } = render(MatchHeatmapHeader, {
      props: { records, filterFrom: '', filterTo: '', seasonFrom: ymd(-5), seasonTo: ymd(2), windowWeeks: 26 },
    })
    const active = activeDates(baseElement)
    expect(active.length).toBeGreaterThan(1)
    expect(active).toContain(ymd(-3)) // inside the span
    expect(active).not.toContain(ymd(-20)) // outside the span, still in-grid
  })

  it('lets a manual date range take precedence over the season overlay', () => {
    const { baseElement } = render(MatchHeatmapHeader, {
      props: {
        records,
        filterFrom: `${ymd(-3)}T00:00`, filterTo: `${ymd(-3)}T23:59`,
        seasonFrom: ymd(-5), seasonTo: ymd(2),
        windowWeeks: 26,
      },
    })
    // Only the manually-picked single day is active — the wider season is ignored.
    expect(activeDates(baseElement)).toEqual([ymd(-3)])
  })

  it('shows no highlight with neither a range nor a season', () => {
    const { baseElement } = render(MatchHeatmapHeader, {
      props: { records, filterFrom: '', filterTo: '', seasonFrom: '', seasonTo: '', windowWeeks: 26 },
    })
    expect(activeDates(baseElement)).toEqual([])
  })
})

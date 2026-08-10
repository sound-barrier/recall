import { describe, it, expect } from 'vitest'

import { bandEndpoints, clampSpanToCells, type BandCell } from '@/components/matches/timeline/sparkline-band'

// A tiny five-day window; the band math only ever compares date strings, so a
// contiguous run of days is a faithful stand-in for the real 13/26/52-week grid.
const cells: BandCell[] = ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04', '2026-03-05']
  .map((date) => ({ date }))

describe('clampSpanToCells — a season span clamped to the visible window', () => {
  it('clamps a span that opens before the window and closes after it', () => {
    expect(clampSpanToCells(cells, '2026-01-01', '2026-12-31')).toEqual([0, 4])
  })

  it('keeps the exact endpoints of a span that sits inside the window', () => {
    expect(clampSpanToCells(cells, '2026-03-02', '2026-03-04')).toEqual([1, 3])
  })

  it('clamps to the first in-grid day when the span starts before the window', () => {
    expect(clampSpanToCells(cells, '2026-02-01', '2026-03-02')).toEqual([0, 1])
  })

  it('clamps to the last in-grid day when the span runs past the window', () => {
    expect(clampSpanToCells(cells, '2026-03-04', '2026-04-30')).toEqual([3, 4])
  })

  it('draws nothing for a span entirely after the window', () => {
    expect(clampSpanToCells(cells, '2026-06-01', '2026-06-30')).toEqual([null, null])
  })

  it('draws nothing for a span entirely before the window', () => {
    expect(clampSpanToCells(cells, '2026-01-01', '2026-01-31')).toEqual([null, null])
  })

  it('draws nothing when the window has no cells at all', () => {
    expect(clampSpanToCells([], '2026-03-01', '2026-03-05')).toEqual([null, null])
  })

  it('draws nothing for an inverted span (to before from)', () => {
    expect(clampSpanToCells(cells, '2026-03-04', '2026-03-02')).toEqual([null, null])
  })
})

const noBand = { drag: null, filterFrom: '', filterTo: '', seasonFrom: '', seasonTo: '' }

describe('bandEndpoints — which range the band shows', () => {
  it('shows nothing when neither a range nor a season is set', () => {
    expect(bandEndpoints({ cells, ...noBand })).toEqual([null, null])
  })

  it('follows the in-flight drag, even backwards', () => {
    expect(bandEndpoints({ cells, ...noBand, drag: [3, 1] })).toEqual([3, 1])
  })

  it('lets the in-flight drag override both the applied range and the season', () => {
    expect(bandEndpoints({
      cells,
      drag: [0, 1],
      filterFrom: '2026-03-03T00:00', filterTo: '2026-03-04T23:59',
      seasonFrom: '2026-03-01', seasonTo: '2026-03-05',
    })).toEqual([0, 1])
  })

  it('maps the applied range onto its cells, trimming the minute bounds', () => {
    expect(bandEndpoints({
      ...noBand, cells,
      filterFrom: '2026-03-02T00:00', filterTo: '2026-03-04T23:59',
    })).toEqual([1, 3])
  })

  it('shows nothing when the applied range falls outside the window', () => {
    expect(bandEndpoints({
      ...noBand, cells,
      filterFrom: '2025-11-02T00:00', filterTo: '2025-11-04T23:59',
    })).toEqual([null, null])
  })

  it('falls back to the picked season when no range is applied', () => {
    expect(bandEndpoints({ ...noBand, cells, seasonFrom: '2026-02-01', seasonTo: '2026-03-03' }))
      .toEqual([0, 2])
  })

  // The calendar heatmap beside this chart drops its season overlay the moment
  // EITHER bound is present (`if (props.filterFrom || props.filterTo) return
  // null`). The sparkline used to require both, so typing only a start date in
  // the narrow panel left the season band lit here while the heatmap went dark
  // — the two vizzes disagreeing about the active range.
  it('lets a half-open manual range suppress the season overlay', () => {
    expect(bandEndpoints({ ...noBand, cells, filterFrom: '2026-03-02T00:00', seasonFrom: '2026-03-01', seasonTo: '2026-03-05' }))
      .toEqual([null, null])
    expect(bandEndpoints({ ...noBand, cells, filterTo: '2026-03-04T23:59', seasonFrom: '2026-03-01', seasonTo: '2026-03-05' }))
      .toEqual([null, null])
  })
})

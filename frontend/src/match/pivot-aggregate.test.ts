import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import { makePivotFields } from '@/match/pivot-fields'
import { pivot, formatPivotCell, type PivotConfig, type ValueSpec } from '@/match/pivot-aggregate'

const heroRole = (h: string | null | undefined): string =>
  ({ ana: 'support', kiriko: 'support', dva: 'tank' } as Record<string, string>)[h ?? ''] ?? ''
const fields = makePivotFields(heroRole)

function rec(data: Partial<MatchRecord['data']> = {}, top: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: `m-${Math.random()}`,
    source_files: [],
    parsed_at: '2026-05-10T20:00:00Z',
    data: { ...data },
    ...top,
  } as unknown as MatchRecord
}

function cfg(over: Partial<PivotConfig>): PivotConfig {
  return { rows: [], columns: [], values: [], filters: [], ...over }
}

const COUNT: ValueSpec = { field: 'matches', agg: 'count' }

describe('pivot — aggregation math', () => {
  it('counts matches into single-dimension rows', () => {
    const res = pivot(
      [rec({ hero: 'ana' }), rec({ hero: 'ana' }), rec({ hero: 'dva' })],
      cfg({ rows: ['hero'], values: [COUNT] }),
      fields,
    )
    expect(res.rowKeys).toEqual([['ana'], ['dva']])
    expect(res.colKeys).toEqual([[]]) // no column dimension → a single column
    expect(res.cells[0]?.[0]?.[0]).toBe(2)
    expect(res.cells[1]?.[0]?.[0]).toBe(1)
    expect(res.grandTotals[0]).toBe(3)
  })

  it('computes win rate as a percentage (3W / 1L → 75)', () => {
    const recs = [
      rec({ result: 'victory' }), rec({ result: 'victory' }),
      rec({ result: 'victory' }), rec({ result: 'defeat' }),
    ]
    const res = pivot(recs, cfg({ values: [{ field: 'matches', agg: 'winRate' }] }), fields)
    expect(res.grandTotals[0]).toBe(75)
    expect(formatPivotCell(res.grandTotals[0] ?? null, 'winRate')).toBe('75%')
  })

  it('sums / averages / min / max a measure, skipping null samples', () => {
    const recs = [rec({ eliminations: 10 }), rec({ eliminations: 20 }), rec({})]
    const res = pivot(recs, cfg({
      values: [
        { field: 'eliminations', agg: 'sum' },
        { field: 'eliminations', agg: 'avg' },
        { field: 'eliminations', agg: 'min' },
        { field: 'eliminations', agg: 'max' },
      ],
    }), fields)
    expect(res.grandTotals[0]).toBe(30) // sum
    expect(res.grandTotals[1]).toBe(15) // avg over the two non-null samples
    expect(res.grandTotals[2]).toBe(10) // min
    expect(res.grandTotals[3]).toBe(20) // max
  })

  it('guards K/D against divide-by-zero deaths', () => {
    const noDeaths = pivot([rec({ eliminations: 12, deaths: 0 })], cfg({ values: [{ field: 'matches', agg: 'kd' }] }), fields)
    expect(noDeaths.grandTotals[0]).toBe(12) // 12 / max(1, 0)
    const withDeaths = pivot([rec({ eliminations: 12, deaths: 4 })], cfg({ values: [{ field: 'matches', agg: 'kd' }] }), fields)
    expect(withDeaths.grandTotals[0]).toBe(3)
  })

  it('places a multi-hero match in every hero bucket (counts do not sum to N)', () => {
    const recs = [rec({ heroes_played: [{ hero: 'ana', percent_played: 60 }, { hero: 'kiriko', percent_played: 40 }] })]
    const res = pivot(recs, cfg({ rows: ['hero'], values: [COUNT] }), fields)
    expect(res.rowKeys).toEqual([['ana'], ['kiriko']])
    expect(res.cells[0]?.[0]?.[0]).toBe(1)
    expect(res.cells[1]?.[0]?.[0]).toBe(1)
    expect(res.grandTotals[0]).toBe(1) // the record itself counts once
  })

  it('reconciles row totals with the cells across columns (single-value dims)', () => {
    const recs = [
      rec({ hero: 'ana', result: 'victory' }),
      rec({ hero: 'ana', result: 'defeat' }),
      rec({ hero: 'dva', result: 'victory' }),
    ]
    const res = pivot(recs, cfg({ rows: ['hero'], columns: ['result'], values: [COUNT] }), fields)
    expect(res.colKeys).toEqual([['defeat'], ['victory']]) // localeCompare order
    expect(res.cells[0]?.[0]?.[0]).toBe(1) // ana / defeat
    expect(res.cells[0]?.[1]?.[0]).toBe(1) // ana / victory
    expect(res.rowTotals[0]?.[0]).toBe(2) // ana margin reconciles
    expect(res.colTotals[1]?.[0]).toBe(2) // victory margin (ana + dva)
    expect(res.grandTotals[0]).toBe(3)
  })

  it('buckets missing dimension values under "(none)"', () => {
    const res = pivot([rec({ map: '' }), rec({ map: 'rialto' })], cfg({ rows: ['map'], values: [COUNT] }), fields)
    const labels = res.rowKeys.map((k) => k[0])
    expect(labels).toContain('(none)')
    expect(labels).toContain('rialto')
    expect(res.recordCount).toBe(2)
  })

  it('applies pivot filters before bucketing', () => {
    const res = pivot(
      [rec({ hero: 'ana' }), rec({ hero: 'dva' })],
      cfg({ rows: ['hero'], values: [COUNT], filters: [{ field: 'hero', allowed: ['ana'] }] }),
      fields,
    )
    expect(res.recordCount).toBe(1)
    expect(res.rowKeys).toEqual([['ana']])
  })

  it('falls back to default values (count + win rate) when none chosen', () => {
    const res = pivot([rec({ result: 'victory' })], cfg({}), fields)
    expect(res.valueLabels).toEqual(['Matches', 'Win rate'])
    expect(res.grandTotals).toEqual([1, 100])
  })
})

describe('formatPivotCell', () => {
  it('renders by aggregation kind, em-dash for null', () => {
    expect(formatPivotCell(null, 'count')).toBe('—')
    expect(formatPivotCell(62.4, 'winRate')).toBe('62%')
    expect(formatPivotCell(1.5, 'kd')).toBe('1.50')
    expect(formatPivotCell(14.5, 'avg')).toBe('14.50')
    expect(formatPivotCell(30, 'sum')).toBe('30')
  })
})

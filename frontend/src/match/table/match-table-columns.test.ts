import { describe, expect, it } from 'vitest'
import type { MatchRecord } from '@/api-client'
import {
  TABLE_COLUMNS,
  TABLE_COLUMN_ORDER,
  type TableSortCol,
} from '@/match/table/match-table-columns'

// The registry is the single source of truth for the data table's column
// axis: header labels, the per-column ascending comparator, and the
// rendered cell text (the TSV payload). These pin the registry's own
// contract; the sort/TSV behavior over real records stays pinned by
// useTableSort.test.ts and the MatchesTable suites.

function rec(over: Partial<MatchRecord> & { data?: Partial<MatchRecord['data']> }): MatchRecord {
  const { data, ...top } = over
  return {
    match_key: 'match-2026-01-01T00-00-00',
    data: { map: '', result: '', ...data },
    ...top,
  } as MatchRecord
}

describe('TABLE_COLUMNS registry', () => {
  it('TABLE_COLUMN_ORDER is a permutation of the registry keys', () => {
    const orderSet = new Set<TableSortCol>(TABLE_COLUMN_ORDER)
    expect(orderSet.size).toBe(TABLE_COLUMN_ORDER.length)
    expect([...orderSet].sort()).toEqual(Object.keys(TABLE_COLUMNS).sort())
  })

  it('every column carries a non-empty header label', () => {
    for (const col of TABLE_COLUMN_ORDER) {
      expect(`${col}:${TABLE_COLUMNS[col].label}`).not.toBe(`${col}:`)
    }
  })

  it('result compares victory above draw above defeat ascending, unknown last', () => {
    const victory = rec({ data: { result: 'victory' } })
    const draw = rec({ data: { result: 'draw' } })
    const defeat = rec({ data: { result: 'defeat' } })
    const unknown = rec({ data: { result: '' } })
    const cmp = TABLE_COLUMNS.result.compare
    expect(cmp(victory, draw)).toBeLessThan(0)
    expect(cmp(draw, defeat)).toBeLessThan(0)
    expect(cmp(defeat, unknown)).toBeLessThan(0)
    expect(cmp(victory, victory)).toBe(0)
  })

  it('source orders the provenance ladder ocr < edited < manual and renders it', () => {
    const ocr = rec({})
    const manual = rec({ source: 'manual' })
    const cmp = TABLE_COLUMNS.source.compare
    expect(cmp(ocr, manual)).toBeLessThan(0)
    expect(TABLE_COLUMNS.source.text(ocr, () => '')).toBe('ocr')
    expect(TABLE_COLUMNS.source.text(manual, () => '')).toBe('manual')
  })

  it('numeric columns compare by value with absent-as-zero', () => {
    const nine = rec({ data: { eliminations: 9 } })
    const none = rec({ data: {} })
    expect(TABLE_COLUMNS.eliminations.compare(none, nine)).toBeLessThan(0)
    expect(TABLE_COLUMNS.eliminations.text(nine, () => '')).toBe('9')
    expect(TABLE_COLUMNS.eliminations.text(none, () => '')).toBe('')
  })
})

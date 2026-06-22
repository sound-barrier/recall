import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api'
import { buildSelectionTsv, cellText } from '@/match/match-table-tsv'

const heroRole = (h: string | null | undefined) =>
  ({ lucio: 'support', dva: 'tank' } as Record<string, string>)[h ?? ''] ?? ''

function rec(key: string, data: Record<string, unknown>, over: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data, ...over } as unknown as MatchRecord
}

describe('match-table-tsv', () => {
  it('renders multi-value hero/role cells with their in-cell separators', () => {
    const r = rec('a', {
      map: 'rialto',
      result: 'victory',
      heroes_played: [{ hero: 'dva', percent_played: 60 }, { hero: 'lucio', percent_played: 40 }],
    })
    expect(cellText(r, 'hero', heroRole)).toBe('dva, lucio')
    expect(cellText(r, 'role', heroRole)).toBe('tank, support')
    expect(cellText(r, 'map', heroRole)).toBe('rialto')
    expect(cellText(r, 'result', heroRole)).toBe('victory')
  })

  it('builds tab-separated rows for the selected rectangle', () => {
    const rows = [
      rec('a', { map: 'rialto', result: 'victory', eliminations: 17 }),
      rec('b', { map: 'busan', result: 'defeat', eliminations: 9 }),
    ]
    const tsv = buildSelectionTsv(rows, ['map', 'eliminations', 'result'], heroRole)
    expect(tsv).toBe('rialto\t17\tvictory\nbusan\t9\tdefeat')
  })

  // The numeric cells distinguish "absent" (→ '') from a real 0, which is falsy
  // but `!= null`, so it must still render as "0".
  it('renders numeric cells, keeping 0 distinct from absent', () => {
    const filled = rec('a', { eliminations: 17, assists: 16, deaths: 0 })
    expect(cellText(filled, 'eliminations', heroRole)).toBe('17')
    expect(cellText(filled, 'assists', heroRole)).toBe('16')
    expect(cellText(filled, 'deaths', heroRole)).toBe('0')

    const empty = rec('b', {})
    expect(cellText(empty, 'eliminations', heroRole)).toBe('')
    expect(cellText(empty, 'assists', heroRole)).toBe('')
    expect(cellText(empty, 'deaths', heroRole)).toBe('')
  })

  it('falls back to empty string for absent map / result', () => {
    const empty = rec('a', {})
    expect(cellText(empty, 'map', heroRole)).toBe('')
    expect(cellText(empty, 'result', heroRole)).toBe('')
  })

  it('joins tags with "; " and renders empty when there are none', () => {
    const tagged = rec('a', {}, { annotation: { tags: ['stack', 'stream'] } } as Partial<MatchRecord>)
    expect(cellText(tagged, 'tags', heroRole)).toBe('stack; stream')
    expect(cellText(rec('b', {}), 'tags', heroRole)).toBe('')
  })

  it('marks edited and manual provenance with "yes" / ""', () => {
    expect(cellText(rec('a', {}, { source: 'ocr_edited' } as Partial<MatchRecord>), 'edited', heroRole)).toBe('yes')
    expect(cellText(rec('b', {}, { source: 'ocr' } as Partial<MatchRecord>), 'edited', heroRole)).toBe('')
    expect(cellText(rec('c', {}, { source: 'manual' } as Partial<MatchRecord>), 'manual', heroRole)).toBe('yes')
    expect(cellText(rec('d', {}, { source: 'ocr' } as Partial<MatchRecord>), 'manual', heroRole)).toBe('')
  })

  it('renders delegated play-mode / queue labels', () => {
    expect(cellText(rec('a', { playlist: 'quickplay' }), 'playMode', heroRole)).toBe('Quickplay')
    expect(cellText(rec('b', {}, { queue_type: 'role' } as Partial<MatchRecord>), 'queue', heroRole)).toBe('Role Queue')
    expect(cellText(rec('c', {}, { queue_type: 'open' } as Partial<MatchRecord>), 'queue', heroRole)).toBe('Open Queue')
  })

  it('renders the date cell from date + finished time, em-dash when undated', () => {
    const dated = rec('a', { date: '2026-05-10', finished_at: '21:29' })
    expect(cellText(dated, 'date', heroRole)).toContain('21:29')
    // No date → formatRowDate yields the em-dash placeholder; the empty
    // finished_at is filtered out, so the cell is just "—".
    expect(cellText(rec('b', {}), 'date', heroRole)).toBe('—')
  })
})

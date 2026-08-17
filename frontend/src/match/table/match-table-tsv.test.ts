import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api'
import { buildSelectionTsv, cellText } from '@/match/table/match-table-tsv'

const heroRole = (h: string | null | undefined) =>
  ({ lucio: 'support', dva: 'tank' } as Record<string, string>)[h ?? ''] ?? ''

function rec(key: string, data: Record<string, unknown>, over: Partial<MatchRecord> = {}): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data, ...over } as unknown as MatchRecord
}

describe('match-table-tsv', () => {
  // Copying a cell must say what the cell says. During a coaching session
  // the visible row is on the player's clock; a TSV built from the viewer's
  // clock hands the coach a different time — and, across a day boundary, a
  // different date — than the one they are looking at.
  it('copies the player\'s clock when the rows are on loan', () => {
    const r = rec('match-2026-08-14T21-14-00', {
      date: '2026-08-14', finished_at: '21:14', played_at_utc: '2026-08-15T06:14:00Z',
      map: 'kings row', result: 'victory',
    })
    expect(cellText(r, 'date', heroRole, 'player')).toContain('21:14')
    expect(cellText(r, 'date', heroRole, 'player')).toContain('Aug 14')
  })

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

  it('renders the source cell with the badge vocabulary', () => {
    expect(cellText(rec('a', {}, { source: 'ocr_edited' } as Partial<MatchRecord>), 'source', heroRole)).toBe('edited')
    expect(cellText(rec('b', {}, { source: 'manual' } as Partial<MatchRecord>), 'source', heroRole)).toBe('manual')
    expect(cellText(rec('c', {}, { source: 'ocr' } as Partial<MatchRecord>), 'source', heroRole)).toBe('ocr')
    expect(cellText(rec('d', {}), 'source', heroRole)).toBe('ocr')
  })

  it('renders the KDA cell as (E+A)/D floored at one death, blank without stats', () => {
    expect(cellText(rec('a', { eliminations: 20, assists: 10, deaths: 8 }), 'kda', heroRole)).toBe('3.75')
    expect(cellText(rec('b', { eliminations: 5, assists: 5, deaths: 0 }), 'kda', heroRole)).toBe('10')
    expect(cellText(rec('c', {}), 'kda', heroRole)).toBe('')
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

import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api'
import { buildSelectionTsv, cellText } from '@/match/match-table-tsv'

const heroRole = (h: string | null | undefined) =>
  ({ lucio: 'support', dva: 'tank' } as Record<string, string>)[h ?? ''] ?? ''

function rec(key: string, data: Record<string, unknown>): MatchRecord {
  return { match_key: key, source_files: [`${key}.png`], data } as unknown as MatchRecord
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
})

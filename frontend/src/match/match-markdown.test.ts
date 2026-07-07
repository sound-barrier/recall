import { describe, it, expect } from 'vitest'
import type { MatchRecord } from '@/api-client'
import { matchToMarkdown, matchSummaryLine } from '@/match/match-markdown'

function rec(over: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: 'match-x',
    source_files: ['shot.png'],
    source_types: { 'shot.png': 'teams' },
    data: {
      map: 'rialto', hero: 'lucio', result: 'victory', final_score: '3-1',
      date: '2026-05-10', game_length: '11:25',
      eliminations: 17, assists: 16, deaths: 11,
      damage: 12843, healing: 9021, mitigation: 3310,
    },
    annotation: { leaver: '', note: 'clutch', replay_code: 'AB12CD', members: ['Apollo'], tags: ['stack'] },
    ...over,
  } as unknown as MatchRecord
}

describe('matchToMarkdown', () => {
  it('renders title, stats table, journal, and screenshot refs', () => {
    const md = matchToMarkdown(rec(), { mapDisplay: 'Rialto' })
    expect(md).toContain('# Rialto — victory (2026-05-10)')
    expect(md).toContain('| E / A / D | 17 / 16 / 11 |')
    expect(md).toContain('| Damage | 12843 |')
    expect(md).toContain('> clutch')
    expect(md).toContain('- Replay: `AB12CD`')
    expect(md).toContain('- Squad: Apollo')
    expect(md).toContain('- Tags: #stack')
    expect(md).toContain('- `shot.png` (teams)')
  })

  it('drops empty sections wholesale', () => {
    const bare = rec({ annotation: undefined, source_files: [], source_types: {} } as unknown as Partial<MatchRecord>)
    const md = matchToMarkdown(bare)
    expect(md).not.toContain('## Journal')
    expect(md).not.toContain('## Screenshots')
  })
})

describe('matchSummaryLine', () => {
  it('renders the compact one-liner with empty parts dropped', () => {
    expect(matchSummaryLine(rec())).toBe('rialto · lucio · 17/16/11 · victory · AB12CD')
    const noReplay = rec()
    noReplay.annotation = { leaver: '', members: [], tags: [] } as MatchRecord['annotation']
    expect(matchSummaryLine(noReplay)).toBe('rialto · lucio · 17/16/11 · victory')
  })
})

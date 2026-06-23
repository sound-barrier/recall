import { describe, it, expect } from 'vitest'

import type { MatchRecord } from '@/api'
import { matchesToCSV, MATCH_CSV_HEADERS } from '@/match/match-csv'

// heroRole stub: returns '' so rolesForHeader falls back to data.role,
// keeping these fixtures terse (the role-resolution path is covered by
// match-helpers' own tests).
const noRole = () => ''

function rec(over: Partial<MatchRecord> = {}, data: Partial<MatchRecord['data']> = {}): MatchRecord {
  return {
    match_key: 'match-2026-05-10T20-00-00',
    source_files: ['a.png'],
    parsed_at: '2026-05-10T20:30:00Z',
    data: {
      date: '2026-05-10',
      finished_at: '21:29',
      game_length: '11:25',
      map: 'rialto',
      game_mode: 'escort',
      playlist: 'competitive',
      role: 'support',
      result: 'victory',
      final_score: '3-1',
      hero: 'ana',
      eliminations: 20,
      assists: 10,
      deaths: 8,
      damage: 9800,
      healing: 1500,
      mitigation: 0,
      ...data,
    },
    ...over,
  } as unknown as MatchRecord
}

// Drop the BOM and trailing CRLF, return the data rows split on CRLF.
function lines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').replace(/\r\n$/, '').split('\r\n')
}

describe('matchesToCSV — container', () => {
  it('prepends a UTF-8 BOM so Excel detects UTF-8', () => {
    expect(matchesToCSV([rec()], noRole).startsWith('\uFEFF')).toBe(true)
  })

  it('terminates every row with CRLF (incl. the last)', () => {
    const csv = matchesToCSV([rec()], noRole)
    expect(csv.endsWith('\r\n')).toBe(true)
    // header + 1 data row, each CRLF-terminated → exactly two CRLFs.
    expect(csv.match(/\r\n/g)).toHaveLength(2)
  })

  it('emits the stable, comprehensive header row first', () => {
    const csv = matchesToCSV([rec()], noRole)
    expect(lines(csv)[0]).toBe(MATCH_CSV_HEADERS.join(','))
    // Spot-check the split fields the feature exists to expose.
    expect(MATCH_CSV_HEADERS).toEqual(expect.arrayContaining([
      'playlist', 'play_mode', 'queue_type', 'eliminations', 'assists', 'deaths',
    ]))
  })

  it('writes one row per match in order', () => {
    const csv = matchesToCSV([rec({ match_key: 'm-a' }), rec({ match_key: 'm-b' })], noRole)
    const rows = lines(csv)
    expect(rows).toHaveLength(3) // header + 2
    expect(rows[1]!.startsWith('m-a,')).toBe(true)
    expect(rows[2]!.startsWith('m-b,')).toBe(true)
  })
})

describe('matchesToCSV — cell values', () => {
  it('maps each scalar field to its own column', () => {
    const csv = matchesToCSV([rec()], noRole)
    const row = lines(csv)[1]!
    const cells = row.split(',')
    const at = (h: string) => cells[MATCH_CSV_HEADERS.indexOf(h)]
    expect(at('map')).toBe('rialto')
    expect(at('playlist')).toBe('competitive')
    expect(at('play_mode')).toBe('competitive')
    expect(at('result')).toBe('victory')
    expect(at('eliminations')).toBe('20')
    expect(at('assists')).toBe('10')
    expect(at('deaths')).toBe('8')
    expect(at('mitigation')).toBe('0') // a real zero must not vanish
  })

  it('prefers the play_mode override over the raw playlist', () => {
    const csv = matchesToCSV([rec({ play_mode: 'quickplay' } as Partial<MatchRecord>)], noRole)
    const cells = lines(csv)[1]!.split(',')
    expect(cells[MATCH_CSV_HEADERS.indexOf('playlist')]).toBe('competitive')
    expect(cells[MATCH_CSV_HEADERS.indexOf('play_mode')]).toBe('quickplay')
  })

  it('resolves the effective queue type into its own column', () => {
    const csv = matchesToCSV([rec({ queue_type: 'role' } as Partial<MatchRecord>)], noRole)
    const cells = lines(csv)[1]!.split(',')
    expect(cells[MATCH_CSV_HEADERS.indexOf('queue_type')]).toBe('role')
  })

  it('renders missing / undefined fields as empty cells, never "undefined"', () => {
    const bare = { match_key: 'm-bare', source_files: [], data: {} } as unknown as MatchRecord
    const csv = matchesToCSV([bare], noRole)
    expect(csv).not.toContain('undefined')
    expect(csv).not.toContain('null')
    const cells = lines(csv)[1]!.split(',')
    expect(cells[MATCH_CSV_HEADERS.indexOf('map')]).toBe('')
  })

  it('joins multi-value fields with "; " inside a single cell', () => {
    const csv = matchesToCSV([rec(
      { annotation: { tags: ['clutch', 'comeback'], members: ['bob', 'sue'] } } as unknown as Partial<MatchRecord>,
      { heroes_played: [{ hero: 'ana', percent_played: 30 }, { hero: 'kiriko', percent_played: 70 }] },
    )], noRole)
    const cells = lines(csv)[1]!.split(',')
    // Sorted most-played first; no comma in the cell → unquoted.
    expect(cells[MATCH_CSV_HEADERS.indexOf('heroes_played')]).toBe('kiriko; ana')
    expect(cells[MATCH_CSV_HEADERS.indexOf('tags')]).toBe('clutch; comeback')
    expect(cells[MATCH_CSV_HEADERS.indexOf('members')]).toBe('bob; sue')
  })
})

describe('matchesToCSV — RFC-4180 quoting', () => {
  function noteCSV(note: string): string {
    return matchesToCSV([rec({ annotation: { note } } as unknown as Partial<MatchRecord>)], noRole)
  }

  it('quotes a cell containing a comma', () => {
    expect(noteCSV('won, barely')).toContain('"won, barely"')
  })

  it('doubles internal quotes and wraps the cell', () => {
    expect(noteCSV('she said "go"')).toContain('"she said ""go"""')
  })

  it('keeps an embedded newline inside one quoted cell', () => {
    const csv = noteCSV('line1\nline2')
    expect(csv).toContain('"line1\nline2"')
    // The embedded \n must NOT be mistaken for a row terminator (CRLF).
    expect(lines(csv)).toHaveLength(2)
  })

  it('quotes a cell with leading/trailing whitespace', () => {
    expect(noteCSV(' spaced ')).toContain('" spaced "')
  })

  it('leaves a plain cell unquoted', () => {
    expect(noteCSV('clean note')).toContain(',clean note,')
  })
})

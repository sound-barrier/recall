// Flat, one-row-per-match CSV export of the matches workspace. Pure +
// deterministic so it round-trips through Vitest without a mount. The
// output is RFC-4180 (CRLF rows, doubled internal quotes) with a UTF-8
// BOM prepended so Excel and Google Sheets both detect the encoding and
// import every column cleanly. Multi-value fields (heroes played, tags,
// team members) collapse into a single "; "-joined cell rather than
// exploding the row, keeping the grain one match per line.
//
// This is intentionally NOT the zip-of-CSVs whole-database backup
// (pkg/app/export_csv.go / ExportDataCSV) — that's a round-trippable
// snapshot of the raw per-type tables. This is the analyst's sheet: the
// aggregated MatchRecord the user sees in the data view, every field its
// own column, ready to pivot in a spreadsheet.

import type { MatchRecord } from '@/api-client'
import { heroesForHeader, rolesForHeader } from '@/match/match-helpers'

type HeroRole = (hero: string | null | undefined) => string
type CsvValue = string | number | null | undefined

interface CsvColumn {
  header: string
  get: (rec: MatchRecord, heroRole: HeroRole) => CsvValue
}

// Column order is the public contract of the export — stable so a user's
// downstream spreadsheet formulas keep pointing at the right column
// across releases. Split fields (playlist vs effective play_mode, queue,
// and E/A/D as three columns) are the whole point of the sheet.
const COLUMNS: readonly CsvColumn[] = [
  { header: 'match_key',     get: (r) => r.match_key },
  { header: 'date',          get: (r) => r.data?.date },
  { header: 'finished_at',   get: (r) => r.data?.finished_at },
  { header: 'game_length',   get: (r) => r.data?.game_length },
  { header: 'map',           get: (r) => r.data?.map },
  { header: 'game_mode',     get: (r) => r.data?.game_mode },
  { header: 'playlist',      get: (r) => r.data?.playlist },
  // Effective play mode: the user's override wins, else the OCR-derived
  // playlist — the same precedence formatPlayModeLabel uses for the cell.
  { header: 'play_mode',     get: (r) => r.play_mode ?? r.data?.playlist },
  { header: 'queue_type',    get: (r) => r.queue_type },
  { header: 'result',        get: (r) => r.data?.result },
  { header: 'final_score',   get: (r) => r.data?.final_score },
  { header: 'role',          get: (r, heroRole) => rolesForHeader(r, heroRole).join('; ') },
  { header: 'hero',          get: (r) => r.data?.hero },
  { header: 'heroes_played', get: (r) => heroesForHeader(r).map((h) => h.hero).join('; ') },
  { header: 'eliminations',  get: (r) => r.data?.eliminations },
  { header: 'assists',       get: (r) => r.data?.assists },
  { header: 'deaths',        get: (r) => r.data?.deaths },
  { header: 'damage',        get: (r) => r.data?.damage },
  { header: 'healing',       get: (r) => r.data?.healing },
  { header: 'mitigation',    get: (r) => r.data?.mitigation },
  { header: 'rank',          get: (r) => r.data?.rank },
  { header: 'level',         get: (r) => r.data?.level },
  { header: 'reviewed_by',   get: (r) => r.reviewed_by },
  { header: 'source',        get: (r) => r.source },
  { header: 'leaver',        get: (r) => r.annotation?.leaver },
  { header: 'note',          get: (r) => r.annotation?.note },
  { header: 'replay_code',   get: (r) => r.annotation?.replay_code },
  { header: 'members',       get: (r) => (r.annotation?.members ?? []).join('; ') },
  { header: 'tags',          get: (r) => (r.annotation?.tags ?? []).join('; ') },
]

// The export's column headers, in order. Exported so callers (and tests)
// can address cells by name without restating the list.
export const MATCH_CSV_HEADERS: readonly string[] = COLUMNS.map((c) => c.header)

const BOM = '﻿'
const CRLF = '\r\n'

// RFC-4180 field encode. A field is quoted (and its internal quotes
// doubled) only when it contains a quote, comma, CR, LF, or
// leading/trailing whitespace — the cases where a naive split would
// mis-parse it. Numbers stringify bare; null/undefined/non-finite →
// empty cell (never the literal "undefined"/"null"/"NaN").
function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (value === '') return ''
  const needsQuote = /[",\r\n]/.test(value) || value !== value.trim()
  return needsQuote ? `"${value.replace(/"/g, '""')}"` : value
}

// matchesToCSV renders the records as a single flat sheet — one header
// row plus one row per match — Excel/Sheets-ready. `heroRole` resolves a
// hero name to its role for the joined `role` column (typically
// useOWData().heroRole); pass `() => ''` to fall back to the stored role.
export function matchesToCSV(records: readonly MatchRecord[], heroRole: HeroRole): string {
  const header = MATCH_CSV_HEADERS.join(',')
  const rows = records.map((rec) => COLUMNS.map((c) => csvCell(c.get(rec, heroRole))).join(','))
  return BOM + [header, ...rows].map((line) => line + CRLF).join('')
}

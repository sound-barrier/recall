import type { MatchRecord } from '@/api-client'
import {
  formatFinishedAt,
  formatRowDate,
  heroesForHeader,
  isEditedMatch,
  isManualMatch,
  rolePlays,
  sortedHeroPlays,
} from '@/match/match-helpers'
import { formatPlayModeLabel, formatQueueTypeLabel } from '@/match/match-label-helpers'
import { formatKda, kdaRatio } from '@/match/match-stats-helpers'
import { matchTime } from '@/match/match-time-helpers'

// The data table's column axis as ONE registry: header label, ascending
// comparator, and rendered cell text (the TSV clipboard payload) per
// column. The same fact used to live in three parallel enumerations —
// the label array, compareCol's switch, and cellText's switch — so
// adding a column meant three edits and the compiler checked none of
// the pairings. Record<TableSortCol, …> makes a missing column a type
// error, and both the sort stack and the TSV builder read this table.

export type TableSortCol =
  | 'date'
  | 'result'
  | 'map'
  | 'playMode'
  | 'queue'
  | 'hero'
  | 'role'
  | 'eliminations'
  | 'assists'
  | 'deaths'
  | 'kda'
  | 'tags'
  | 'source'

// Resolves a hero name to its role label (useOWData().heroRole shape);
// threaded into text() because role cells derive from the hero list.
export type HeroRole = (hero: string | null | undefined) => string

export interface TableColumnSpec {
  label: string
  // Ascending comparison; the sort stack flips for descending.
  compare(a: MatchRecord, b: MatchRecord): number
  // The displayed value of the cell — mirrors what the cell renders
  // (multi-value hero/role/tags join with their in-cell separators).
  text(rec: MatchRecord, heroRole: HeroRole): string
}

// Victory above draw above defeat when sorting ascending.
const RESULT_RANK: Record<string, number> = { victory: 0, draw: 1, defeat: 2 }

// Provenance ladder: untouched OCR rows first ascending, then edited,
// then hand-entered — one click clusters machine truth, a second
// surfaces the human-touched rows.
function sourceRank(rec: MatchRecord): number {
  if (isManualMatch(rec)) return 2
  if (isEditedMatch(rec)) return 1
  return 0
}

function sourceCellText(rec: MatchRecord): string {
  if (isManualMatch(rec)) return 'manual'
  if (isEditedMatch(rec)) return 'edited'
  return 'ocr'
}

function intCell(v: number | null | undefined): string {
  return v != null ? String(v) : ''
}

export const TABLE_COLUMNS: Record<TableSortCol, TableColumnSpec> = {
  date: {
    label: 'When',
    // The match's own date + time (data.date + finished_at), NOT
    // parsed_at — the user sorts by when they PLAYED, not when the
    // file was ingested. matchTime() returns a sortable ISO key.
    compare: (a, b) => matchTime(a).localeCompare(matchTime(b)),
    text: (rec) => [formatRowDate(rec), formatFinishedAt(rec)].filter(Boolean).join(' '),
  },
  result: {
    label: 'Result',
    compare: (a, b) =>
      (RESULT_RANK[a.data?.result ?? ''] ?? 9) - (RESULT_RANK[b.data?.result ?? ''] ?? 9),
    text: (rec) => rec.data?.result ?? '',
  },
  map: {
    label: 'Map',
    compare: (a, b) => (a.data?.map ?? '').localeCompare(b.data?.map ?? ''),
    text: (rec) => rec.data?.map ?? '',
  },
  // Mode + Queue sort by the EFFECTIVE label the cell shows, not the
  // raw data.playlist / queue_type — playMode prefers the user's
  // play_mode override, queue resolves the auto-detected value — so a
  // header click orders rows the way the user reads them.
  playMode: {
    label: 'Mode',
    compare: (a, b) => formatPlayModeLabel(a).localeCompare(formatPlayModeLabel(b)),
    text: (rec) => formatPlayModeLabel(rec),
  },
  queue: {
    label: 'Queue',
    compare: (a, b) => formatQueueTypeLabel(a).localeCompare(formatQueueTypeLabel(b)),
    text: (rec) => formatQueueTypeLabel(rec),
  },
  hero: {
    label: 'Hero',
    // The MOST-PLAYED hero (heroesForHeader sorts by percent_played
    // desc), not the primary data.hero.
    compare: (a, b) =>
      (heroesForHeader(a)[0]?.hero ?? '').localeCompare(heroesForHeader(b)[0]?.hero ?? ''),
    text: (rec) => sortedHeroPlays(rec).map((h) => h.hero).join(', '),
  },
  role: {
    label: 'Role',
    compare: (a, b) => (a.data?.role ?? '').localeCompare(b.data?.role ?? ''),
    text: (rec, heroRole) => rolePlays(rec, heroRole).map((r) => r.role).join(', '),
  },
  eliminations: {
    label: 'Elims',
    compare: (a, b) => (a.data?.eliminations ?? 0) - (b.data?.eliminations ?? 0),
    text: (rec) => intCell(rec.data?.eliminations),
  },
  assists: {
    label: 'Assists',
    compare: (a, b) => (a.data?.assists ?? 0) - (b.data?.assists ?? 0),
    text: (rec) => intCell(rec.data?.assists),
  },
  deaths: {
    label: 'Deaths',
    compare: (a, b) => (a.data?.deaths ?? 0) - (b.data?.deaths ?? 0),
    text: (rec) => intCell(rec.data?.deaths),
  },
  kda: {
    label: 'KDA',
    compare: (a, b) => (kdaRatio(a.data) ?? 0) - (kdaRatio(b.data) ?? 0),
    text: (rec) => formatKda(kdaRatio(rec.data)),
  },
  tags: {
    label: 'Tags',
    compare: (a, b) =>
      (a.annotation?.tags?.[0] ?? '').localeCompare(b.annotation?.tags?.[0] ?? ''),
    text: (rec) => (rec.annotation?.tags ?? []).join('; '),
  },
  source: {
    label: 'Source',
    compare: (a, b) => sourceRank(a) - sourceRank(b),
    text: (rec) => sourceCellText(rec),
  },
}

// Render order for headers and the Custom Sort dialog. Kept explicit
// (not Object.keys) so reordering the display is a one-line edit; the
// registry contract test pins that it stays a permutation of the keys.
export const TABLE_COLUMN_ORDER: readonly TableSortCol[] = [
  'date',
  // Outcome right after the timestamp — the first thing scanned per
  // row, not the last.
  'result',
  'map',
  'playMode',
  'queue',
  'hero',
  'role',
  'eliminations',
  'assists',
  'deaths',
  'kda',
  'tags',
  'source',
]

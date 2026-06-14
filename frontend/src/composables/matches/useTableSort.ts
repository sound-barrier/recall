import type { MatchRecord } from '@/api'
import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from '@/composables/shared/usePersistedRef'
import { heroesForHeader } from '@/match/match-helpers'
import { matchTime } from '@/match/match-time-helpers'

// Multi-column ("Excel-style") sort for the `data`-density match table.
// Data density is a flat spreadsheet: the headers drive an ordered STACK
// of sort keys over the WHOLE table (no grouping). A plain header click
// sorts by that column alone; Shift+click appends the column as the next
// tie-break level. The stack persists across sessions. Default is a
// single date-descending key — newest match first, matching the leaf list.

export type TableSortCol =
  | 'date'
  | 'map'
  | 'mode'
  | 'hero'
  | 'role'
  | 'eliminations'
  | 'result'
  | 'tags'

export type SortDir = 'asc' | 'desc'

export interface SortLevel {
  col: TableSortCol
  dir: SortDir
}

// The sortable columns in render order, with their header labels. Shared
// by the table headers and the Custom Sort dialog so both read one source
// of truth for which columns exist and what they're called.
export const TABLE_SORT_COLUMNS: ReadonlyArray<{ col: TableSortCol; label: string }> = [
  { col: 'date', label: 'When' },
  { col: 'map', label: 'Map' },
  { col: 'mode', label: 'Mode' },
  { col: 'hero', label: 'Hero' },
  { col: 'role', label: 'Role' },
  { col: 'eliminations', label: 'E / A / D' },
  { col: 'tags', label: 'Tags' },
  { col: 'result', label: 'Result' },
]

const SORT_COLS = new Set<TableSortCol>(TABLE_SORT_COLUMNS.map((c) => c.col))
const STORAGE_KEY = 'recall.matchesTableSort'
const DEFAULT_STACK: readonly SortLevel[] = [{ col: 'date', dir: 'desc' }]

// Victory above draw above defeat when sorting ascending.
const RESULT_RANK: Record<string, number> = { victory: 0, draw: 1, defeat: 2 }

// Ascending comparison for one column; the caller flips for descending.
function compareCol(col: TableSortCol, a: MatchRecord, b: MatchRecord): number {
  const da = a.data
  const db = b.data
  switch (col) {
    // The match's own date + time (data.date + finished_at), NOT
    // parsed_at — the user sorts by when they PLAYED, not when the file
    // was ingested. matchTime() returns a sortable ISO key.
    case 'date':         return matchTime(a).localeCompare(matchTime(b))
    case 'map':          return (da?.map ?? '').localeCompare(db?.map ?? '')
    case 'mode':         return (da?.playlist ?? '').localeCompare(db?.playlist ?? '')
    // The MOST-PLAYED hero (heroesForHeader sorts by percent_played
    // desc), not the primary data.hero.
    case 'hero':         return (heroesForHeader(a)[0]?.hero ?? '').localeCompare(heroesForHeader(b)[0]?.hero ?? '')
    case 'role':         return (da?.role ?? '').localeCompare(db?.role ?? '')
    case 'eliminations': return (da?.eliminations ?? 0) - (db?.eliminations ?? 0)
    case 'result':       return (RESULT_RANK[da?.result ?? ''] ?? 9) - (RESULT_RANK[db?.result ?? ''] ?? 9)
    case 'tags':         return (a.annotation?.tags?.[0] ?? '').localeCompare(b.annotation?.tags?.[0] ?? '')
  }
}

// Fold the sort stack: the first level that separates a and b wins;
// when every level ties, fall back to newest-ingested-first so the order
// stays deterministic.
function compareMulti(levels: readonly SortLevel[], a: MatchRecord, b: MatchRecord): number {
  for (const { col, dir } of levels) {
    const c = compareCol(col, a, b) * (dir === 'asc' ? 1 : -1)
    if (c !== 0) return c
  }
  return (b.parsed_at ?? '').localeCompare(a.parsed_at ?? '')
}

// A persisted stack is an array of {col,dir} over known columns with no
// duplicate column. A hand-corrupted value fails the guard and the
// caller falls back to the default stack.
function isSortStack(decoded: unknown): decoded is SortLevel[] {
  if (!Array.isArray(decoded)) return false
  const seen = new Set<string>()
  for (const level of decoded) {
    if (!level || typeof level !== 'object') return false
    const { col, dir } = level as Record<string, unknown>
    if (typeof col !== 'string' || !SORT_COLS.has(col as TableSortCol)) return false
    if (dir !== 'asc' && dir !== 'desc') return false
    if (seen.has(col)) return false
    seen.add(col)
  }
  return true
}

function flip(dir: SortDir): SortDir {
  return dir === 'asc' ? 'desc' : 'asc'
}

function freshDefault(): SortLevel[] {
  return DEFAULT_STACK.map((level) => ({ ...level }))
}

export function useTableSort() {
  const { value: sortKeys, set } = usePersistedRef<SortLevel[]>({
    key: STORAGE_KEY,
    defaultValue: freshDefault(),
    parse: parseJsonRecord(isSortStack),
    serialize: serializeJsonRecord,
  })

  function indexOf(col: TableSortCol): number {
    return sortKeys.value.findIndex((level) => level.col === col)
  }

  // A header click. Plain click sorts by `col` alone — flipping direction
  // when it's already the primary key, otherwise starting fresh ascending.
  // Shift+click (append) folds `col` in as the next tie-break level, or
  // flips it in place if already present. Re-click never removes a level;
  // that's the Custom Sort dialog's job.
  function cycleSort(col: TableSortCol, opts?: { append?: boolean }): void {
    const cur = sortKeys.value
    const idx = indexOf(col)
    if (opts?.append) {
      if (idx >= 0) set(cur.map((level, i) => (i === idx ? { col, dir: flip(level.dir) } : level)))
      else set([...cur, { col, dir: 'asc' }])
      return
    }
    const primary = cur[0]
    if (idx === 0 && primary) set([{ col, dir: flip(primary.dir) }])
    else set([{ col, dir: 'asc' }])
  }

  function addLevel(col: TableSortCol): void {
    if (indexOf(col) < 0) set([...sortKeys.value, { col, dir: 'asc' }])
  }

  function removeLevel(col: TableSortCol): void {
    set(sortKeys.value.filter((level) => level.col !== col))
  }

  function setLevelDir(col: TableSortCol, dir: SortDir): void {
    set(sortKeys.value.map((level) => (level.col === col ? { col, dir } : level)))
  }

  // Repoint a level at a different column, keeping its position and
  // direction. No-op when the target is already a level (a column sorts
  // the table at most once); the dialog's per-row picker won't offer one.
  function setLevelColumn(from: TableSortCol, to: TableSortCol): void {
    if (from === to || indexOf(to) >= 0) return
    set(sortKeys.value.map((level) => (level.col === from ? { col: to, dir: level.dir } : level)))
  }

  // Move `col` by `delta` positions (negative = earlier), clamped to the
  // stack bounds.
  function moveLevel(col: TableSortCol, delta: number): void {
    const cur = sortKeys.value
    const from = cur.findIndex((level) => level.col === col)
    const to = from + delta
    if (from < 0 || to < 0 || to >= cur.length) return
    const moved = cur[from]
    if (!moved) return
    const next = [...cur]
    next.splice(from, 1)
    next.splice(to, 0, moved)
    set(next)
  }

  function clearSort(): void {
    set(freshDefault())
  }

  // 1-based position of `col` in the stack (for header level badges);
  // 0 when the column isn't sorted.
  function sortLevelOf(col: TableSortCol): number {
    return indexOf(col) + 1
  }

  // aria-sort for a header — each sorted column carries its own
  // direction; unsorted columns are 'none'.
  function ariaSort(col: TableSortCol): 'ascending' | 'descending' | 'none' {
    const level = sortKeys.value.find((l) => l.col === col)
    if (!level) return 'none'
    return level.dir === 'asc' ? 'ascending' : 'descending'
  }

  // Stable multi-key sort of a copy of `records`.
  function sortRows(records: readonly MatchRecord[]): MatchRecord[] {
    const levels = sortKeys.value
    return [...records].sort((a, b) => compareMulti(levels, a, b))
  }

  return {
    sortKeys,
    cycleSort,
    addLevel,
    removeLevel,
    setLevelDir,
    setLevelColumn,
    moveLevel,
    clearSort,
    sortLevelOf,
    ariaSort,
    sortRows,
  }
}

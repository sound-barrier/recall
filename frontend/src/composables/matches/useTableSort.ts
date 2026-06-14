import { ref } from 'vue'

import type { MatchRecord } from '@/api'
import { heroesForHeader } from '@/match/match-helpers'
import { matchTime } from '@/match/match-time-helpers'

// Per-column sort for the `data`-density match table. Data density is a
// flat spreadsheet: the active column header sorts the WHOLE table (no
// grouping). Default is date-descending — newest match first, matching
// the leaf-row list's default.

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

export function useTableSort() {
  const sortCol = ref<TableSortCol>('date')
  const sortDir = ref<SortDir>('desc')

  // A header click on the active column flips direction; on a new
  // column it selects that column ascending.
  function cycleSort(col: TableSortCol) {
    if (sortCol.value === col) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc'
    } else {
      sortCol.value = col
      sortDir.value = 'asc'
    }
  }

  // The `aria-sort` value for a header — only the active column carries
  // ascending/descending; the rest are 'none'.
  function ariaSort(col: TableSortCol): 'ascending' | 'descending' | 'none' {
    if (sortCol.value !== col) return 'none'
    return sortDir.value === 'asc' ? 'ascending' : 'descending'
  }

  // Stable-sort a copy of `records` by the active column + direction;
  // ties fall back to newest-first so the order is deterministic.
  function sortRows(records: readonly MatchRecord[]): MatchRecord[] {
    const dir = sortDir.value === 'asc' ? 1 : -1
    const col = sortCol.value
    return [...records].sort((a, b) => {
      const c = compareCol(col, a, b)
      if (c !== 0) return c * dir
      return (b.parsed_at ?? '').localeCompare(a.parsed_at ?? '')
    })
  }

  return { sortCol, sortDir, cycleSort, ariaSort, sortRows }
}

import { ref } from 'vue'

import type { MatchRecord } from '../api'

// Per-column sort for the `data`-density match table. The Y/M/W/D
// grouping (useMatchesGroup) decides which group a row lands in and the
// order of the groups themselves; this sort orders the rows WITHIN each
// group (and the whole list in the ungrouped/flat path). Default is
// date-descending — the same newest-first the leaf-row list shows.

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
    case 'date':         return (a.parsed_at ?? '').localeCompare(b.parsed_at ?? '')
    case 'map':          return (da?.map ?? '').localeCompare(db?.map ?? '')
    case 'mode':         return (da?.playlist ?? '').localeCompare(db?.playlist ?? '')
    case 'hero':         return (da?.hero ?? '').localeCompare(db?.hero ?? '')
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

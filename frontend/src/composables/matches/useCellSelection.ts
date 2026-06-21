import { computed, ref, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import type { TableSortCol } from '@/composables/matches/useTableSort'
import { buildSelectionTsv } from '@/match/match-table-tsv'

type HeroRole = (hero: string | null | undefined) => string
interface Cell { key: string; col: number }

// Excel-style cell-range selection for the data table: drag a rectangle of
// cells, Ctrl+C copies it as TSV (pastes into a spreadsheet as a grid). Row
// coordinates are match keys (stable across the virtual window); columns are
// indices into `cols`.
export function useCellSelection(rows: Ref<MatchRecord[]>, cols: readonly TableSortCol[], heroRole: HeroRole) {
  const anchor = ref<Cell | null>(null)
  const focus = ref<Cell | null>(null)
  const dragging = ref(false)

  const keyToRow = computed(() => {
    const m = new Map<string, number>()
    rows.value.forEach((r, i) => m.set(r.match_key, i))
    return m
  })

  const rect = computed(() => {
    if (!anchor.value || !focus.value) return null
    const ar = keyToRow.value.get(anchor.value.key)
    const fr = keyToRow.value.get(focus.value.key)
    if (ar == null || fr == null) return null
    return {
      minRow: Math.min(ar, fr),
      maxRow: Math.max(ar, fr),
      minCol: Math.min(anchor.value.col, focus.value.col),
      maxCol: Math.max(anchor.value.col, focus.value.col),
    }
  })

  const hasSelection = computed(() => rect.value != null)

  // The selected column indices for one row (empty when the row is outside the
  // selection) — drives the per-cell highlight in MatchTableRow.
  function selectedColsFor(key: string): number[] {
    const r = rect.value
    if (!r) return []
    const row = keyToRow.value.get(key)
    if (row == null || row < r.minRow || row > r.maxRow) return []
    const out: number[] = []
    for (let c = r.minCol; c <= r.maxCol; c++) out.push(c)
    return out
  }

  function startAt(key: string, col: number): void {
    anchor.value = { key, col }
    focus.value = { key, col }
    dragging.value = true
  }
  function extendTo(key: string, col: number): void {
    if (dragging.value) focus.value = { key, col }
  }
  function endDrag(): void {
    dragging.value = false
  }
  function clear(): void {
    anchor.value = null
    focus.value = null
    dragging.value = false
  }

  // Copy the selected rectangle to the clipboard as TSV. Returns the payload (or
  // '' when nothing is selected) so callers/tests can assert it.
  async function copy(): Promise<string> {
    const r = rect.value
    if (!r) return ''
    const selRows = rows.value.slice(r.minRow, r.maxRow + 1)
    const selCols = cols.slice(r.minCol, r.maxCol + 1) as TableSortCol[]
    const tsv = buildSelectionTsv(selRows, selCols, heroRole)
    await navigator.clipboard.writeText(tsv)
    return tsv
  }

  return { dragging, hasSelection, selectedColsFor, startAt, extendTo, endDrag, clear, copy }
}

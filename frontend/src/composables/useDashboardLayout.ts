import { computed, type ComputedRef } from 'vue'

import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from './usePersistedRef'
import {
  DEFAULT_ROW_LAYOUT,
  widgetById,
} from '../dashboard/widgets'

// Persisted row layout for the dossier. Shape on disk:
//
//   recall.dashboard.layout = {"1":["winrate","avg-kda",...],"2":["top-maps",...]}
//
// Each entry maps a row index to the ordered list of widget IDs in
// that row. The layout is the SINGLE source of truth for "is this
// widget rendered" — membership = visible, absence = absent. A widget
// not in any row simply doesn't appear in the dossier; users add
// missing widgets back through the customizer's "+ Add" gallery.
//
// **First install** seeds the layout from `DEFAULT_ROW_LAYOUT` (via
// `defaultLayout()`). Once the user has any stored layout — even a
// pristine copy of the default — that layout is authoritative.
// Trash-on-widget removes from the layout; a later shipped widget
// (default or opt-in) only enters the user's dossier via the
// customizer. Otherwise the trash button would lose to a stale
// "re-add the missing default" pass on every reload.
//
// **Reconciliation on read** is therefore minimal:
//
//   1. Drop IDs no longer in WIDGET_REGISTRY (silent orphan-drop).
//   2. Dedupe — if an ID somehow lives in two rows, keep the first
//      occurrence and drop the rest.
//   3. Seed any default-row index that the stored layout omits as
//      an empty array, so callers iterating `rows.value[1]` /
//      `rows.value[2]` always find a (possibly empty) row to render.

export const LAYOUT_STORAGE_KEY = 'recall.dashboard.layout'

// Soft-thresholds for `appendToRow`. Adding a widget to a row that
// already holds this many of its shape kicks the new widget into a
// fresh row below — keeps the dossier's headline-then-detail
// rhythm even as the user piles widgets on.
const KPI_ROW_SOFT_MAX = 5
const BREAKDOWN_ROW_SOFT_MAX = 4

export type RowLayout = Record<number, string[]>

export interface DashboardLayoutApi {
  rows: ComputedRef<RowLayout>
  // Move a widget. Same-row reorder when fromRow === toRow; cross-
  // row move otherwise. Callers don't have to special-case either
  // — the math collapses to one branch when the source + target are
  // the same row.
  move: (id: string, fromRow: number, fromIdx: number, toRow: number, toIdx: number) => void
  setRow: (row: number, ids: string[]) => void
  // Atomic whole-layout write. Used by the live-reflow drag's
  // commit path: the rendered preview IS the destination layout,
  // so we persist it as-is rather than translating back into a
  // single move() call with index gymnastics. Filters out IDs the
  // registry no longer recognises (same orphan-drop policy as
  // setRow).
  setLayout: (layout: RowLayout) => void
  // Append a widget to its default row (or a fresh overflow row if
  // the default already holds >= the soft-threshold for the
  // widget's shape). Idempotent — a duplicate add is a no-op.
  appendToRow: (rowIdx: number, id: string) => void
  // Remove a widget from whichever row it lives in. If the
  // resulting row is empty AND its index is past the last default
  // row, the row is deleted entirely (auto-prune user-created
  // overflow rows).
  removeFromRow: (id: string) => void
  reset: () => void
}

let cached: DashboardLayoutApi | null = null

export function useDashboardLayout(): DashboardLayoutApi {
  if (cached) return cached

  const { value: rawLayout, set } = usePersistedRef<RowLayout>({
    key: LAYOUT_STORAGE_KEY,
    defaultValue: defaultLayout(),
    parse: parseJsonRecord(isRowLayout),
    serialize: serializeJsonRecord,
  })

  // Public surface: the reconciled layout. The raw stored value is
  // kept as-is in `rawLayout` (so subsequent writes round-trip the
  // canonical form), and `rows` derives the live, registry-correct
  // shape callers actually consume.
  const rows = computed<RowLayout>(() => reconcile(rawLayout.value))

  // toIdx is the FINAL destination index in the post-removal
  // target row. Callers (keyboard handler, drag onDrop) are
  // responsible for translating their semantic into this form —
  // useDragReorder.onDragOver/onDrop compensates for same-row
  // source-before-target by emitting toIdx - 1 at the consumer
  // edge, and the keyboard handler emits the natural "swap with
  // adjacent" index directly. Keeping the math here dumb means
  // there's exactly one place each caller has to reason about
  // index translation.
  function move(id: string, fromRow: number, fromIdx: number, toRow: number, toIdx: number) {
    if (!widgetById(id)) return
    const next = cloneLayout(rows.value)
    // Source-row removal. fromIdx is treated as a hint — if the
    // widget moved between the consumer reading the model and the
    // move() call, walk the row to find the real position. Keeps
    // drag interruptions from corrupting state.
    const sourceRow = next[fromRow] ?? []
    let sourceIdx = fromIdx
    if (sourceRow[sourceIdx] !== id) {
      sourceIdx = sourceRow.indexOf(id)
    }
    if (sourceIdx === -1) return
    sourceRow.splice(sourceIdx, 1)
    next[fromRow] = sourceRow

    // Target-row insert at toIdx, clamped to the post-removal row
    // length so a stale toIdx past the end falls back to "append".
    const targetRow = next[toRow] ?? []
    const insertAt = Math.max(0, Math.min(toIdx, targetRow.length))
    targetRow.splice(insertAt, 0, id)
    next[toRow] = targetRow

    set(next)
  }

  function setRow(row: number, ids: string[]) {
    const valid = ids.filter((id) => widgetById(id) !== undefined)
    const next = cloneLayout(rows.value)
    next[row] = valid
    set(next)
  }

  function setLayout(layout: RowLayout) {
    const next: RowLayout = {}
    for (const [k, ids] of Object.entries(layout)) {
      const rowIdx = Number(k)
      if (!Number.isFinite(rowIdx)) continue
      next[rowIdx] = ids.filter((id) => widgetById(id) !== undefined)
    }
    set(next)
  }

  function appendToRow(rowIdx: number, id: string) {
    const def = widgetById(id)
    if (!def) return
    const current = rows.value
    // Idempotent: if the widget is already somewhere in the layout,
    // don't double-add it.
    for (const r of Object.values(current)) {
      if (r.includes(id)) return
    }
    const next = cloneLayout(current)
    const targetRow = nextRowForAppend(next, rowIdx, def.shape)
    const arr = next[targetRow] ?? []
    arr.push(id)
    next[targetRow] = arr
    set(next)
  }

  function removeFromRow(id: string) {
    const current = rows.value
    const next = cloneLayout(current)
    let found = false
    for (const key of Object.keys(next)) {
      const rowIdx = Number(key)
      const arr = next[rowIdx]!
      const idx = arr.indexOf(id)
      if (idx === -1) continue
      arr.splice(idx, 1)
      next[rowIdx] = arr
      found = true
      // After the splice, if this row is empty AND it's an overflow
      // row (past the last default row), drop the row entirely so
      // the customizer's empty user-rows don't haunt the layout.
      if (arr.length === 0 && rowIdx > maxDefaultRow()) {
        delete next[rowIdx]
      }
      break
    }
    if (found) set(next)
  }

  function reset() {
    set(defaultLayout())
  }

  cached = { rows, move, setRow, setLayout, appendToRow, removeFromRow, reset }
  return cached
}

export function _resetDashboardLayoutForTest(): void {
  cached = null
}

// ─── Pure helpers (exported only for test reuse) ────────────────

export function defaultLayout(): RowLayout {
  const out: RowLayout = {}
  for (const key of Object.keys(DEFAULT_ROW_LAYOUT)) {
    out[Number(key)] = [...DEFAULT_ROW_LAYOUT[Number(key)]!]
  }
  return out
}

// Type-guard for `parseJsonRecord` — confirms the decoded value is
// a record mapping number-like string keys to string arrays.
export function isRowLayout(v: unknown): v is RowLayout {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false
  for (const [key, val] of Object.entries(v)) {
    if (!/^-?\d+$/.test(key)) return false
    if (!Array.isArray(val)) return false
    for (const id of val) {
      if (typeof id !== 'string') return false
    }
  }
  return true
}

// Reconciliation: drop orphans, dedupe, seed missing default rows.
// First-install seeding happens via `defaultLayout()` (the
// usePersistedRef default) — once the user has a stored layout, that
// layout is authoritative and the reconciler does NOT re-add absent
// widgets. Otherwise trash-on-widget would silently lose to a stale
// re-add pass on every reload.
export function reconcile(stored: RowLayout): RowLayout {
  const out: RowLayout = {}
  const seen = new Set<string>()

  // Pass 1: copy stored rows, dropping orphans + duplicates as we
  // encounter them.
  const sortedKeys = Object.keys(stored)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
  for (const rowIdx of sortedKeys) {
    const row = stored[rowIdx] ?? []
    const cleaned: string[] = []
    for (const id of row) {
      if (!widgetById(id)) continue
      if (seen.has(id)) continue
      seen.add(id)
      cleaned.push(id)
    }
    out[rowIdx] = cleaned
  }

  // Pass 2: seed any default-row that the stored layout omitted as
  // an empty array. Lets template iteration always find rows 1 / 2
  // even when the user has emptied them.
  for (const key of Object.keys(DEFAULT_ROW_LAYOUT)) {
    const rowIdx = Number(key)
    if (out[rowIdx] === undefined) {
      out[rowIdx] = []
    }
  }

  return out
}

function cloneLayout(src: RowLayout): RowLayout {
  const out: RowLayout = {}
  for (const [k, v] of Object.entries(src)) {
    out[Number(k)] = [...v]
  }
  return out
}

function maxDefaultRow(): number {
  return Math.max(...Object.keys(DEFAULT_ROW_LAYOUT).map((k) => Number(k)))
}

// Pick the target row for an append. If the requested row is under
// the per-shape soft cap, returns it as-is; otherwise allocates a
// fresh row past the highest existing index and seeds it empty.
function nextRowForAppend(next: RowLayout, rowIdx: number, shape: 'kpi' | 'breakdown'): number {
  const row = next[rowIdx] ?? []
  let shapeCount = 0
  for (const id of row) {
    if (widgetById(id)?.shape === shape) shapeCount++
  }
  const cap = shape === 'kpi' ? KPI_ROW_SOFT_MAX : BREAKDOWN_ROW_SOFT_MAX
  if (shapeCount < cap) {
    next[rowIdx] = row
    return rowIdx
  }
  const maxRow = Math.max(0, ...Object.keys(next).map((k) => Number(k)))
  const overflow = maxRow + 1
  next[overflow] = []
  return overflow
}

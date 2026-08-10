import { computed, type ComputedRef } from 'vue'

import {
  BREAKDOWN_ROW_SOFT_MAX,
  KPI_ROW_SOFT_MAX,
  LAYOUT_STORAGE_KEY,
  defaultLayout,
  isRowLayout,
  maxDefaultRow,
  runLayoutMigrationsOnce,
  type RowLayout,
} from '@/composables/dashboard/dashboardLayout.migrations'
import type { CellPos } from '@/composables/dashboard/useDragReorder'
import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from '@/composables/shared/usePersistedRef'
import {
  DEFAULT_ROW_LAYOUT,
  widgetById,
} from '@/dashboard/widgets'

// Storage keys, version bookkeeping, and the per-version migration
// steps live in the sibling dashboardLayout.migrations module;
// re-exported here so consumers keep one import surface.
export {
  CURRENT_LAYOUT_VERSION,
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION_KEY,
  defaultLayout,
  isRowLayout,
  type RowLayout,
} from '@/composables/dashboard/dashboardLayout.migrations'

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

export interface DashboardLayoutApi {
  rows: ComputedRef<RowLayout>
  // Move a widget. Same-row reorder when from.row === to.row; cross-
  // row move otherwise. Callers don't have to special-case either
  // — the math collapses to one branch when the source + target are
  // the same row.
  move: (id: string, from: CellPos, to: CellPos) => void
  setRow: (row: number, ids: string[]) => void
  // Atomic whole-layout write. Used by the live-reflow drag's
  // commit path: the rendered preview IS the destination layout,
  // so we persist it as-is rather than translating back into a
  // single move() call with index gymnastics. Filters out IDs the
  // registry no longer recognizes (same orphan-drop policy as
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

  // One-shot consolidation migration. Operates directly on
  // localStorage so it runs BEFORE `usePersistedRef` hydrates —
  // otherwise the migration would see the empty default and the
  // user's broken layout would round-trip unchanged. Idempotent:
  // a re-run after the version stamp is a no-op.
  runLayoutMigrationsOnce()

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

  // to.idx is the FINAL destination index in the post-removal
  // target row. Callers (keyboard handler, drag onDrop) are
  // responsible for translating their semantic into this form —
  // useDragReorder.onDragOver/onDrop compensates for same-row
  // source-before-target by emitting to.idx - 1 at the consumer
  // edge, and the keyboard handler emits the natural "swap with
  // adjacent" index directly. Keeping the math here dumb means
  // there's exactly one place each caller has to reason about
  // index translation.
  function move(id: string, from: CellPos, to: CellPos) {
    if (!widgetById(id)) return
    const next = cloneLayout(rows.value)
    // Source-row removal. from.idx is treated as a hint — if the
    // widget moved between the consumer reading the model and the
    // move() call, walk the row to find the real position. Keeps
    // drag interruptions from corrupting state.
    const sourceRow = next[from.row] ?? []
    let sourceIdx = from.idx
    if (sourceRow[sourceIdx] !== id) {
      sourceIdx = sourceRow.indexOf(id)
    }
    if (sourceIdx === -1) return
    sourceRow.splice(sourceIdx, 1)
    next[from.row] = sourceRow

    // Target-row insert at to.idx, clamped to the post-removal row
    // length so a stale to.idx past the end falls back to "append".
    const targetRow = next[to.row] ?? []
    const insertAt = Math.max(0, Math.min(to.idx, targetRow.length))
    targetRow.splice(insertAt, 0, id)
    next[to.row] = targetRow

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

// Pick the target row for an append.
//
//   1. The widget's defaultRow — if its same-shape count is under cap.
//   2. Any existing OVERFLOW row (past max defaultRow) holding only
//      same-shape widgets and still under cap.
//   3. Otherwise spawn a fresh overflow row at maxRow+1.
//
// Step 2 is the fix for the row-explosion bug: previously, "default
// row at cap" → "spawn new row" every time, so a user adding 4 KPIs
// past the cap ended up with 4 single-widget rows instead of one
// 4-KPI overflow row. We only repurpose overflow rows (not other
// shapes' default rows) so a stray KPI never lands in the breakdown
// default row.
function sameShapeCount(row: string[], shape: 'kpi' | 'breakdown'): number {
  let n = 0
  for (const id of row) {
    if (widgetById(id)?.shape === shape) n++
  }
  return n
}

// The first existing overflow row (past max defaultRow, ascending)
// holding only same-shape widgets and still under cap, or null.
function overflowRowWithRoom(next: RowLayout, shape: 'kpi' | 'breakdown', cap: number): number | null {
  const defaultMax = maxDefaultRow()
  const overflowKeys = Object.keys(next)
    .map((k) => Number(k))
    .filter((k) => k > defaultMax)
    .sort((a, b) => a - b)
  for (const k of overflowKeys) {
    const row = next[k] ?? []
    if (row.length >= cap) continue
    if (row.every((id) => widgetById(id)?.shape === shape)) return k
  }
  return null
}

function nextRowForAppend(next: RowLayout, rowIdx: number, shape: 'kpi' | 'breakdown'): number {
  const cap = shape === 'kpi' ? KPI_ROW_SOFT_MAX : BREAKDOWN_ROW_SOFT_MAX

  // Step 1: defaultRow if it has same-shape capacity.
  const def = next[rowIdx] ?? []
  if (sameShapeCount(def, shape) < cap) {
    next[rowIdx] = def
    return rowIdx
  }

  // Step 2: existing overflow rows matching shape with room.
  const existing = overflowRowWithRoom(next, shape, cap)
  if (existing !== null) {
    next[existing] = next[existing] ?? []
    return existing
  }

  // Step 3: spawn a fresh overflow row.
  const maxRow = Math.max(0, ...Object.keys(next).map((k) => Number(k)))
  const overflow = maxRow + 1
  next[overflow] = []
  return overflow
}

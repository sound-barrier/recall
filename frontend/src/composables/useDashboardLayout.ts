import { computed, type ComputedRef } from 'vue'

import {
  usePersistedRef,
  parseJsonRecord,
  serializeJsonRecord,
} from './usePersistedRef'
import {
  DEFAULT_ROW_LAYOUT,
  WIDGET_REGISTRY,
  widgetById,
} from '../dashboard/widgets'

// Persisted row layout for the dossier. Shape on disk:
//
//   recall.dashboard.layout = {"1":["winrate","avg-kda",...],"2":["top-maps",...]}
//
// Each entry maps a row index to the ordered list of widget IDs in
// that row. A single key for the whole layout keeps cross-row
// moves atomic — a drag that pulls a widget from row 1 into row 2
// is a single localStorage write, never a transient state where
// the widget appears in both rows or in neither.
//
// **Reconciliation on read** (so future-shipped widgets surface
// gracefully + corrupted state degrades to defaults):
//
//   1. Drop IDs no longer in WIDGET_REGISTRY.
//   2. Dedupe — if an ID somehow lives in two rows, keep the first
//      occurrence and drop the rest.
//   3. For each registry widget NOT present in any stored row,
//      append it to its `defaultRow`. New widgets shipped after the
//      user customized their layout surface at the tail of the
//      registry-assigned row, not silently absent.
//   4. Any row index in DEFAULT_ROW_LAYOUT missing from storage
//      seeds from the default. Adding a new row (Phase 4) lights up
//      with its default widgets without wiping the user's existing
//      customization.

export const LAYOUT_STORAGE_KEY = 'recall.dashboard.layout'

export type RowLayout = Record<number, string[]>

export interface DashboardLayoutApi {
  rows: ComputedRef<RowLayout>
  // Move a widget. Same-row reorder when fromRow === toRow; cross-
  // row move otherwise. Callers don't have to special-case either
  // — the math collapses to one branch when the source + target are
  // the same row.
  move: (id: string, fromRow: number, fromIdx: number, toRow: number, toIdx: number) => void
  setRow: (row: number, ids: string[]) => void
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

  function reset() {
    set(defaultLayout())
  }

  cached = { rows, move, setRow, reset }
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

// Reconciliation: drop orphans, dedupe, append missing widgets.
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

  // Pass 2: seed any default-row that the stored layout omitted.
  for (const key of Object.keys(DEFAULT_ROW_LAYOUT)) {
    const rowIdx = Number(key)
    if (out[rowIdx] === undefined) {
      out[rowIdx] = []
    }
  }

  // Pass 3: append every registered widget that didn't appear
  // anywhere in the stored layout. Append to defaultRow so newly
  // shipped widgets surface at the row they're declared in.
  for (const def of WIDGET_REGISTRY) {
    if (seen.has(def.id)) continue
    const row = out[def.defaultRow] ?? []
    row.push(def.id)
    out[def.defaultRow] = row
    seen.add(def.id)
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

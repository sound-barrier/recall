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

const LAYOUT_VERSION_KEY = 'recall.dashboard.layoutVersion'

// Bumped to schedule a one-shot consolidation migration. The runner
// in `useDashboardLayout()` compares the stored version against this
// constant; if older (incl. unset), runs the migration pipeline once,
// persists the result, and stamps the new version. Subsequent reads
// trust the stored layout verbatim — never re-shape an already-
// migrated user's dossier on every reload.
//
// Bump history:
//   1 — consolidate single-widget overflow rows of the same shape
//       into denser rows. Fixes the row-explosion bug from
//       pre-row-packing `appendToRow`: users who clicked "+ Add" on
//       every opt-in widget ended up with one widget per row past
//       the install defaults.
const CURRENT_LAYOUT_VERSION = 1

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
function nextRowForAppend(next: RowLayout, rowIdx: number, shape: 'kpi' | 'breakdown'): number {
  const cap = shape === 'kpi' ? KPI_ROW_SOFT_MAX : BREAKDOWN_ROW_SOFT_MAX

  // Step 1: defaultRow if it has same-shape capacity.
  const def = next[rowIdx] ?? []
  let defShapeCount = 0
  for (const id of def) {
    if (widgetById(id)?.shape === shape) defShapeCount++
  }
  if (defShapeCount < cap) {
    next[rowIdx] = def
    return rowIdx
  }

  // Step 2: existing overflow rows past max defaultRow, ascending,
  // matching shape with room.
  const defaultMax = maxDefaultRow()
  const overflowKeys = Object.keys(next)
    .map((k) => Number(k))
    .filter((k) => k > defaultMax)
    .sort((a, b) => a - b)
  for (const k of overflowKeys) {
    const row = next[k] ?? []
    if (row.length >= cap) continue
    if (row.every((id) => widgetById(id)?.shape === shape)) {
      next[k] = row
      return k
    }
  }

  // Step 3: spawn a fresh overflow row.
  const maxRow = Math.max(0, ...Object.keys(next).map((k) => Number(k)))
  const overflow = maxRow + 1
  next[overflow] = []
  return overflow
}

// ─── Migration pipeline ────────────────────────────────────────

function runLayoutMigrationsOnce(): void {
  const storedVersion = readLayoutVersion()
  if (storedVersion >= CURRENT_LAYOUT_VERSION) return
  // Read the persisted layout straight from storage — the
  // composable's `usePersistedRef` hasn't hydrated yet at this
  // point. An unset key means "no user layout to migrate"; we
  // still stamp the version so future migrations don't run twice.
  let layout: RowLayout | null = null
  try {
    const raw = localStorage.getItem(LAYOUT_STORAGE_KEY)
    if (raw !== null) {
      const decoded: unknown = JSON.parse(raw)
      if (isRowLayout(decoded)) {
        layout = decoded
      }
    }
  } catch {
    // Unreadable or malformed — leave layout null; nothing to migrate.
  }
  if (layout !== null) {
    let next = layout
    // Migrations run in order. Adding a future migration: append a
    // step here that gates on `storedVersion < N`, mutates `next`.
    if (storedVersion < 1) {
      next = consolidateOverflowRows(next)
    }
    if (!shallowLayoutEqual(layout, next)) {
      try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // Storage write failed — leave the version unstamped so the
        // migration is retried next mount.
        return
      }
    }
  }
  writeLayoutVersion(CURRENT_LAYOUT_VERSION)
}

function readLayoutVersion(): number {
  try {
    const raw = localStorage.getItem(LAYOUT_VERSION_KEY)
    if (raw === null) return 0
    const n = Number(raw)
    return Number.isFinite(n) ? n : 0
  } catch {
    return 0
  }
}

function writeLayoutVersion(v: number): void {
  try {
    localStorage.setItem(LAYOUT_VERSION_KEY, String(v))
  } catch {
    // Storage unavailable — migrations will re-run next mount. That's
    // fine: they're idempotent given a fresh `current` snapshot.
  }
}

// Consolidation re-packs rows PAST the highest default row only.
// Default rows are user-touched terrain and stay verbatim. Overflow
// rows get their contents flattened in row-order, then re-distributed
// into the fewest possible shape-coherent rows respecting the soft
// caps. The result is a deterministic re-pack: same input → same
// output, no row-index churn for users whose overflow rows were
// already correctly packed.
function consolidateOverflowRows(stored: RowLayout): RowLayout {
  const defaultMax = maxDefaultRow()
  const out: RowLayout = {}
  // Carry default rows verbatim.
  for (const [k, v] of Object.entries(stored)) {
    const rowIdx = Number(k)
    if (rowIdx <= defaultMax) out[rowIdx] = [...v]
  }
  // Flatten overflow rows into a single ordered list of (id, shape).
  const overflow: { id: string; shape: 'kpi' | 'breakdown' }[] = []
  const overflowKeys = Object.keys(stored)
    .map((k) => Number(k))
    .filter((n) => n > defaultMax)
    .sort((a, b) => a - b)
  for (const k of overflowKeys) {
    for (const id of stored[k] ?? []) {
      const def = widgetById(id)
      if (!def) continue
      overflow.push({ id, shape: def.shape })
    }
  }
  // Re-pack: contiguous same-shape runs into a row each, splitting
  // when the soft cap is reached or the shape changes.
  let nextIdx = defaultMax + 1
  let row: string[] = []
  let shape: 'kpi' | 'breakdown' | null = null
  function flush() {
    if (row.length === 0) return
    out[nextIdx] = row
    nextIdx++
    row = []
    shape = null
  }
  for (const { id, shape: s } of overflow) {
    const cap = s === 'kpi' ? KPI_ROW_SOFT_MAX : BREAKDOWN_ROW_SOFT_MAX
    if (shape !== s || row.length >= cap) {
      flush()
      shape = s
    }
    row.push(id)
  }
  flush()
  return out
}

function shallowLayoutEqual(a: RowLayout, b: RowLayout): boolean {
  const ak = Object.keys(a)
  const bk = Object.keys(b)
  if (ak.length !== bk.length) return false
  for (const k of ak) {
    const av = a[Number(k)]
    const bv = b[Number(k)]
    if (!av || !bv || av.length !== bv.length) return false
    for (let i = 0; i < av.length; i++) {
      if (av[i] !== bv[i]) return false
    }
  }
  return true
}

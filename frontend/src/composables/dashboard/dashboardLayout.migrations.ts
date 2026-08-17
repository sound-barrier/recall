import { DEFAULT_ROW_LAYOUT, widgetById } from '@/dashboard/widgets'

// Layout defaults + the one-shot migration pipeline for the persisted
// dossier row layout. `useDashboardLayout` composes these; keeping the
// version bookkeeping and per-version steps here keeps the composable
// focused on the live read/write API.

export const LAYOUT_STORAGE_KEY = 'recall.dashboard.layout'

export const LAYOUT_VERSION_KEY = 'recall.dashboard.layoutVersion'

// Bumped to schedule a one-shot migration. The runner in
// `useDashboardLayout()` compares the stored version against this
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
//   2 — re-seed the default rows to the climb-focused layout.
//       Demoted v1 defaults drop (each stays one "+ Add" away);
//       widgets the user added themselves keep their stored row.
//   3 — add the "Ranked above" widget beside Current rank. A new
//       DEFAULT_ROW_LAYOUT entry alone reaches NOBODY who has already
//       launched: reconcile() deliberately never re-adds an absent
//       default (otherwise trashing a widget would lose to a stale
//       re-add), and the version guard returns early. Without this
//       step two users on the identical build get different dossiers
//       decided by when they last opened the app.
export const CURRENT_LAYOUT_VERSION = 4

// The pre-v2 install defaults, frozen for the re-seed migration —
// membership decides which stored widgets were OUR defaults (safe to
// drop) vs the user's own adds (keep).
const V1_DEFAULT_IDS: ReadonlySet<string> = new Set([
  'winrate', 'avg-kda', 'total-time', 'most-played-hero', 'reviewed-count',
  'days-since-review', 'wld-since-review',
  'top-maps', 'top-heroes', 'top-roles', 'heroes-per-match',
])

// Soft-thresholds for `appendToRow`. Adding a widget to a row that
// already holds this many of its shape kicks the new widget into a
// fresh row below — keeps the dossier's headline-then-detail
// rhythm even as the user piles widgets on.
export const KPI_ROW_SOFT_MAX = 5
// Raised from 4 with the v3 default. The cap exists to keep a row tidy, and
// the shipped default row 2 now holds five breakdowns — leaving it at 4 made
// the DEFAULT layout permanently over its own threshold, which broke undo:
// removing a widget from row 2 left 4, and `appendToRow` requires strictly
// fewer than the cap, so Undo spawned a new row instead of restoring in place.
export const BREAKDOWN_ROW_SOFT_MAX = 5

/** Row index → ordered widget IDs; the persisted dossier layout shape. */
export type RowLayout = Record<number, string[]>

// applyMigrationSteps runs every step the stored version has not seen, in
// order. Adding a future migration: append a step gated on `storedVersion < N`
// and bump CURRENT_LAYOUT_VERSION.
function applyMigrationSteps(layout: RowLayout, storedVersion: number): RowLayout {
  let next = layout
  if (storedVersion < 1) next = consolidateOverflowRows(next)
  if (storedVersion < 2) next = reseedClimbDefaults(next)
  if (storedVersion < 3) next = addRankPercentile(next)
  if (storedVersion < 4) next = addClimbInsights(next)
  return next
}

// addClimbInsights seeds ONE of the three trailing-window widgets.
//
// Only Play-vs-rank ships on by default, and that restraint is deliberate. Row
// 1 already carries six KPIs against a soft max of five; adding three more
// would crowd every user's default dossier to surface two readings most have
// not asked for. Play-vs-rank earns the slot because it answers the question
// ranked players actually arrive with — "am I playing well and going nowhere?"
// — using their own numbers. Vs-baseline and Climb-rate stay one click away in
// the gallery for anyone the first card makes curious.
//
// Idempotent: a user who already added it by hand is untouched, and one who
// trashed it gets it back exactly once, the same bargain every versioned
// re-seed makes.
function addClimbInsights(layout: RowLayout): RowLayout {
  for (const ids of Object.values(layout)) {
    if (ids.includes('perf-vs-rank')) return layout
  }
  const next: RowLayout = {}
  for (const [key, ids] of Object.entries(layout)) next[Number(key)] = [...ids]
  next[1] = [...(next[1] ?? []), 'perf-vs-rank']
  return next
}

// addRankPercentile puts "Ranked above" next to Current rank, the reading it
// qualifies. It is additive and idempotent: a user who already has the id
// (added by hand from the gallery) is untouched, and one who deliberately
// trashed it gets it back exactly once — the same bargain every default
// re-seed makes, and the reason this is a versioned step rather than a
// reconcile pass that would re-add it forever.
function addRankPercentile(layout: RowLayout): RowLayout {
  for (const ids of Object.values(layout)) {
    if (ids.includes('rank-percentile')) return layout
  }
  const next: RowLayout = {}
  for (const [key, ids] of Object.entries(layout)) next[Number(key)] = [...ids]
  for (const key of Object.keys(next)) {
    const row = next[Number(key)]!
    const at = row.indexOf('current-rank')
    if (at !== -1) {
      row.splice(at + 1, 0, 'rank-percentile')
      return next
    }
  }
  // No Current rank anywhere — the user removed it. Seed the widget on the
  // default breakdown row rather than inventing one.
  const target = next[2] ?? []
  next[2] = [...target, 'rank-percentile']
  return next
}

/** A fresh mutable copy of the shipped install-default layout. */
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

/** The highest row index the shipped default layout occupies. */
export function maxDefaultRow(): number {
  return Math.max(...Object.keys(DEFAULT_ROW_LAYOUT).map((k) => Number(k)))
}

/**
 * One-shot consolidation migration. Operates directly on localStorage
 * so it runs BEFORE `usePersistedRef` hydrates — otherwise the
 * migration would see the empty default and the user's broken layout
 * would round-trip unchanged. Idempotent: a re-run after the version
 * stamp is a no-op.
 */
export function runLayoutMigrationsOnce(): void {
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
    const next = applyMigrationSteps(layout, storedVersion)
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
// Flatten overflow rows into a single ordered list of (id, shape).
function flattenOverflow(stored: RowLayout, defaultMax: number): { id: string; shape: 'kpi' | 'breakdown' }[] {
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
  return overflow
}

function consolidateOverflowRows(stored: RowLayout): RowLayout {
  const defaultMax = maxDefaultRow()
  const out: RowLayout = {}
  // Carry default rows verbatim.
  for (const [k, v] of Object.entries(stored)) {
    const rowIdx = Number(k)
    if (rowIdx <= defaultMax) out[rowIdx] = [...v]
  }
  const overflow = flattenOverflow(stored, defaultMax)
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

// v2: re-seed the default rows to the climb-focused layout. The new
// DEFAULT_ROW_LAYOUT replaces rows 1–2 wholesale; every stored widget
// that belongs to NEITHER the v1 nor the current default set is the
// user's own add and keeps its stored row (deduped — a user-added
// copy of a now-promoted widget collapses into its default slot).
// Demoted v1 defaults drop: each stays one "+ Add" away.
function reseedClimbDefaults(stored: RowLayout): RowLayout {
  const next = defaultLayout()
  const keep = new Set<string>(Object.values(next).flat())
  const rowKeys = Object.keys(stored)
    .map((k) => Number(k))
    .filter((n) => Number.isInteger(n))
    .sort((a, b) => a - b)
  for (const rowIdx of rowKeys) {
    for (const id of stored[rowIdx] ?? []) {
      if (V1_DEFAULT_IDS.has(id) || keep.has(id)) continue
      keep.add(id)
      ;(next[rowIdx] ??= []).push(id)
    }
  }
  return next
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

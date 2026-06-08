<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MatchRecord } from '../api'
import { GetProfiles } from '../api'
import { useMatchesGroup, type GroupedSection } from '../composables/useMatchesGroup'
import { useMatchesWindow } from '../composables/useMatchesWindow'
import { useMatchesDossier } from '../composables/useMatchesDossier'
import { provideDossier } from '../composables/useDossier'
import WidgetConfigPopover from './WidgetConfigPopover.vue'
import MatchesSortGroupPopover from './MatchesSortGroupPopover.vue'
import { useWeekStart } from '../composables/useWeekStart'
import { useDensity } from '../composables/useDensity'
import { useScrollAffordance } from '../composables/useScrollAffordance'
import { useOWData } from '../composables/useOWData'
import {
  rolesForHeader, formatPlayModeLabel, formatQueueTypeLabel,
  isHeroUnknown, isMapUnknown, formatUnknownHeroLabel, formatUnknownMapLabel,
} from '../match-helpers'
import type { useMatchesNarrow } from '../composables/useMatchesNarrow'
import { useArchiveSelection } from '../composables/useArchiveSelection'
import MatchTimelineHeader from './MatchTimelineHeader.vue'
import DashboardWidget from './DashboardWidget.vue'
import DashboardCustomizer from './DashboardCustomizer.vue'
import BulkActionBar from './BulkActionBar.vue'
// NarrowPopover is the heavyweight authoring surface (the search +
// combobox + range pickers + active-clause range etc.). Lazy-load
// it so MatchesView's initial chunk doesn't carry its ~30K of
// bytes. The popover only mounts (v-if inside the child) when the
// user clicks "Narrow this set", so the deferred fetch is invisible
// in practice. Regression covered by MatchesView.lazy-views.test.ts.
const NarrowPopover = defineAsyncComponent(() => import('./NarrowPopover.vue'))
import DashboardAddTile from './DashboardAddTile.vue'
import DashboardEditBanner from './DashboardEditBanner.vue'
import MatchRowContextMenu from './MatchRowContextMenu.vue'
import DashboardUndoToast from './DashboardUndoToast.vue'
import { useDashboardLayout } from '../composables/useDashboardLayout'
import { useDragReorder } from '../composables/useDragReorder'
import { widgetById, type WidgetDef } from '../dashboard/widgets'
import { useNarrowMode } from '../composables/useNarrowMode'

// Matches page — "set workspace" layout.
//
//   ┌──────────────────────────────────────────────────────┐
//   │  SET DOSSIER                                         │
//   │  ── headline · active-clause chips · narrow trigger  │
//   │  ── KPIs + top maps + top heroes inline              │
//   ├──────────────────────────────────────────────────────┤
//   │  Campaign Log (heatmap + sparkline)                  │
//   │  ── trailing 3/6/12 month view, brushable            │
//   ├──────────────────────────────────────────────────────┤
//   │  Members (the matches of the set)                    │
//   │  ── sort + group controls                            │
//   │  ── grouped section dividers (D / W / M / Y)         │
//   │  ── one row per match, click → drill                 │
//   └──────────────────────────────────────────────────────┘
//
// Filter dimensions exposed via the left "Narrow this set" panel:
//
//   text search (/), preset range, custom from/to dates,
//   map, map type, hero (broad-match against heroes_played[]),
//   role, result, tags, leaver handling, min play time + percent
//   (OR semantics), include-unknown-map toggle.
//
// Unknown-map records are hidden by default — they live in the
// Unknown tab. Toggle in the narrow panel to opt them in. Per-match
// drill-down still emits open-match → App.vue routes through
// useSelectedMatch → MatchDetailPanel (right-side slide-out).

const props = defineProps<{
  records: MatchRecord[]
  // The narrow API bundle, constructed in App.vue so its selection
  // composable can track the same narrowedRecords this view shows.
  // Refs inside the object don't auto-unwrap (Vue 3 caveat), so we
  // destructure into top-level setup vars below — templates then
  // auto-unwrap them.
  narrow: ReturnType<typeof useMatchesNarrow>
  // App.vue's j/k keyboard handlers set this index into narrowed
  // Records; the matching leaf-row carries data-card-index +
  // aria-current="true" so the keyboard nav can scroll the row into
  // view and screen readers announce the focused row.
  focusedCardIndex?: number
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  // Lets App.vue mirror MatchDetailPanel's parity: while the narrow
  // panel is open, App.vue should set `inert` + `aria-hidden` on the
  // background container and ParseStatusBar so screen readers + Tab
  // keyboard nav don't bleed into the dimmed page.
  'narrow-open': [open: boolean]
  // Bulk-hide pipe — emitted once with the full ticked-key list when
  // the user clicks Hide on the bulk action bar. App.vue does
  // Promise.all of SetMatchVisibility(true) + one reload.
  'hide-matches': [matchKeys: string[]]
  // Bulk-write pipes — emitted with the ticked-key list + the value
  // to write. App.vue calls BulkSetMatchPlayMode / BulkSetMatchQueue
  // (single transaction) then triggers one reload. Empty-string
  // value is the bulk Clear semantic (resets every listed row to
  // the "Unknown" bucket).
  'bulk-play-mode': [matchKeys: string[], playMode: import('../api').PlayMode]
  'bulk-queue':     [matchKeys: string[], queueType: import('../api').QueueType]
  // Bulk-export pipe — emitted with the ticked-key list when the
  // user clicks "Export bundle…" on the bulk action bar. App.vue
  // opens the ExportBundleModal to confirm filename + include
  // toggles before calling ExportBundle in api.ts.
  'export-bundle': [matchKeys: string[]]
  // Drawer single-row Unhide — flips one hidden match back to visible.
  'unhide-match': [matchKey: string]
  // Drawer single-row "Delete forever" — hard-deletes one match after
  // the user confirms the two-step inline affordance.
  'hard-delete-match': [matchKey: string]
  // Archive bulk Unhide — fans out across ticked archive rows.
  'unhide-matches': [matchKeys: string[]]
  // Archive bulk "Delete forever" — fans out after the action-bar's
  // two-step confirm.
  'hard-delete-matches': [matchKeys: string[]]
  // Bulk move to another profile — emitted from either action bar
  // after the user picks a target profile from the inline picker.
  'move-matches': [matchKeys: string[], targetProfile: string]
  // "Since this match" anchor cleared from the narrow panel. App.vue
  // owns the persisted anchor state via `useMatchAnchor`, so this
  // bubbles up rather than mutating directly.
  'clear-anchor': []
  // Anchor stamped from the row's right-click context menu. Empty
  // string for "clear." Same App.vue handler the detail panel uses.
  'set-anchor': [matchKey: string]
}>()

// ─── Narrow state via the parent-supplied composable bundle ──
//
// All filter math lives in `useMatchesNarrow`, which App.vue
// instantiates once with shared state so `selection` (the right-
// side detail panel) can paginate against the same narrowedRecords
// this view renders. Destructure into top-level setup vars so
// templates auto-unwrap.
// MatchesView itself only reads the narrowed records + the
// active-chip strip state (anyNarrow, activeClauseCount, the
// picked-* refs surfaced in the chips). All filter authoring
// (combo pickers, range picker, sliders) lives inside the
// NarrowPopover child, which receives the same `props.narrow`
// bundle and destructures the picker callbacks itself.
const {
  searchText,
  pickedMaps, pickedMapTypes, pickedHeroes, pickedRoles, pickedResults, pickedTags, pickedReviewedBy,
  pickedRange, customFrom, customTo,
  leaverHandling, minPlayMinutes, minPlayPercent, includeUnknown,
  anchorKey, sinceAnchorActive,
  pickMap, pickMapType, pickHero, pickRole, pickResult, pickTag, pickReviewedBy, pickRange,
  resetNarrow,
  activeClauseCount, anyNarrow,
  narrowedRecords,
} = props.narrow

// ─── View-side state owned by MatchesView ───────────────────
const narrowOpen = ref(false)
// Narrow rail vs popover. At width >= 1400 px the filter panel
// renders as a peer column on the left of the workspace; below that
// it stays a modal popover triggered by the dossier-actions button.
// `useNarrowMode` also exposes a persisted user override so callers
// can force a mode (no UI surface in this PR).
const { mode: narrowMode } = useNarrowMode()
const sortOrder = ref<'newest' | 'oldest'>('newest')
const groupBy   = ref<'none' | 'day' | 'week' | 'month' | 'year'>('day')

// Sort + Group dropdown — a single trigger button replaces the two
// segmented-button fieldsets that used to live above the leaves
// list. Captures the trigger rect on open so the popover anchors
// to it; close on Esc / click-outside / radio-pick. Density stays
// its own fieldset (toggle, not multi-axis).
const sortGroupOpen   = ref(false)
const sortGroupAnchor = ref<DOMRect | null>(null)

function onSortGroupTriggerClick(e: MouseEvent) {
  const t = e.currentTarget as HTMLElement | null
  if (!t) return
  sortGroupAnchor.value = t.getBoundingClientRect()
  sortGroupOpen.value = !sortGroupOpen.value
}

function closeSortGroup() {
  sortGroupOpen.value = false
  sortGroupAnchor.value = null
}

const SORT_LABELS: Record<'newest' | 'oldest', string> = {
  newest: 'Newest',
  oldest: 'Oldest',
}
const GROUP_LABELS: Record<'none' | 'day' | 'week' | 'month' | 'year', string> = {
  none:  'no group',
  day:   'by day',
  week:  'by week',
  month: 'by month',
  year:  'by year',
}
const sortGroupLabel = computed(() =>
  `${SORT_LABELS[sortOrder.value]} · ${GROUP_LABELS[groupBy.value]}`,
)

// ─── Selection state (Gmail-style, no mode toggle) ──────────
//
// Two parallel selection sets — one for live (visible) match rows,
// one for archived (hidden) rows. Both follow the same affordance
// pattern: a checkbox at the start of each row that hover-reveals
// (subtle when idle, bright on row hover or when ticked), with a
// contextual action bar appearing as soon as the set is non-empty.
// Row-body clicks NEVER touch selection — they still open the detail
// panel (live rows) or are inert (archive rows). The checkbox is the
// only selection affordance.
const selectedKeys = ref<Set<string>>(new Set())

// Archive-drawer state + bulk-action handlers live in
// useArchiveSelection. Destructured to top-level refs so the
// template auto-unwraps them.
const archive = useArchiveSelection({
  records: computed(() => props.records),
  onUnhideMatches: (keys) => emit('unhide-matches', keys),
  onHardDeleteMatches: (keys) => emit('hard-delete-matches', keys),
})
const {
  archiveOpen,
  archiveSelectedKeys,
  archiveConfirmKey,
  archiveBulkConfirm,
  hiddenRecords,
  visibleRecords,
  toggleArchiveSelected,
  clearArchiveSelection,
  selectAllArchive,
  unhideSelectedArchive,
  requestBulkHardDelete,
  cancelBulkHardDelete,
  commitBulkHardDelete,
  confirmHardDelete,
  cancelHardDelete,
} = archive

function toggleSelected(key: string) {
  const next = new Set(selectedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  selectedKeys.value = next
}
function clearSelection() {
  selectedKeys.value = new Set()
}
function hideSelected() {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  clearSelection()
  emit('hide-matches', keys)
}

// Bulk play-mode / queue-type writers. Snapshot the keys (the user
// could check more rows between the action and the round-trip),
// clear the selection so the toolbar collapses, then bubble to
// App.vue which owns the actual api.ts call + the post-write
// reload. Selection clears optimistically because the alternative
// — keeping the checkboxes lit while the PUT is in flight — would
// strand stale state if the reload re-orders the list.
function onBulkPlayMode(playMode: import('../api').PlayMode) {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  clearSelection()
  emit('bulk-play-mode', keys, playMode)
}

function onBulkQueue(queueType: import('../api').QueueType) {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  clearSelection()
  emit('bulk-queue', keys, queueType)
}

// ─── Move-to-profile picker state ───────────────────────────
//
// The picker is a two-step affordance on each action bar: clicking
// "Move to…" replaces the primary buttons with a row of profile-name
// chips (one per OTHER profile). Clicking a chip fires move-matches
// and clears the selection. Cancel reverts to the primary buttons.
// availableProfiles is fetched on mount from /api/v1/profiles; if
// there are no other profiles, the Move button is suppressed (a
// one-profile install has nowhere to move).
const availableProfiles = ref<{ active: string; profiles: string[] }>({ active: '', profiles: [] })
const movePickerOpen = ref<'live' | 'archive' | null>(null)

const otherProfiles = computed(() =>
  availableProfiles.value.profiles.filter((p) => p !== availableProfiles.value.active),
)

function beginMoveLive() {
  if (otherProfiles.value.length === 0) return
  movePickerOpen.value = 'live'
}
function beginMoveArchive() {
  if (otherProfiles.value.length === 0) return
  movePickerOpen.value = 'archive'
}
function cancelMove() {
  movePickerOpen.value = null
}
function commitMove(target: string) {
  if (movePickerOpen.value === 'live') {
    const keys = [...selectedKeys.value]
    if (keys.length === 0) return
    clearSelection()
    movePickerOpen.value = null
    emit('move-matches', keys, target)
    return
  }
  if (movePickerOpen.value === 'archive') {
    const keys = [...archiveSelectedKeys.value]
    if (keys.length === 0) return
    clearArchiveSelection()
    movePickerOpen.value = null
    emit('move-matches', keys, target)
  }
}

// Single-row inline commit for hard-delete (per-archive-row Delete
// button → Confirm/Cancel two-step). `confirmHardDelete` and
// `cancelHardDelete` come from the composable; `commitHardDelete`
// is the one piece that still emits up to App.vue because it talks
// to the parent's DELETE handler directly.
function commitHardDelete(key: string) {
  cancelHardDelete()
  emit('hard-delete-match', key)
}

// Select-all for the LIVE leaves list (the archive variant lives on
// the composable). Targets the narrowed + sorted set the user sees;
// clamps to a no-op when empty.
function selectAllVisible() {
  const keys = sortedRecords.value.map((r) => r.match_key)
  selectedKeys.value = new Set(keys)
}

// ─── Dossier KPIs / breakdowns via useMatchesDossier ───────
//
// The dossier needs a hero→role resolver to drive the open-queue-
// aware Most-played-roles breakdown. useOWData is a session-level
// singleton — it lazy-fetches `/api/v1/system/reference-data` and
// reuses the same reactive store across every consumer.
const ow = useOWData()
// PR B: weekStart drives the day-of-week breakdown's rotation so the
// row matches the user's calendar preference.
const { weekStart } = useWeekStart()
// Row-density preference for the leaves list. Persisted via
// usePersistedRef so the user's choice survives reloads. Default is
// `comfortable` (the historical render).
const { density, setDensity } = useDensity()

// Back-to-top affordance — fixed-position button at lower-left of
// the matches workspace. The composable owns the passive scroll
// listener + the smooth-scroll callback so MatchesView only deals
// with rendering the gated button.
const { isPastThreshold: isPastScrollThreshold, scrollToTop } = useScrollAffordance(400)

// Live count of undated matches in the current narrow. Drives the
// "↓ N undated" jump button next to the density toggle. Uses
// narrowedRecords (not records or sortedRecords) so the count
// automatically respects every active filter — date window, search
// clauses, picked maps / heroes / roles, etc.
const undatedCount = computed(() =>
  narrowedRecords.value.filter(r => !r.data?.date).length,
)

async function onJumpToUndated() {
  if (undatedCount.value === 0) return
  // useMatchesWindow caps the rendered list at one page (20 rows)
  // by default; with a real corpus the "No date" section lives at
  // the very bottom and isn't in the DOM until the user scrolls
  // far enough to trigger the infinite-scroll sentinel. Expand the
  // window all the way first so the section divider exists when we
  // query for it, then wait one tick for Vue to render the rows.
  expandWindowToAll()
  await nextTick()
  // The "No date" group header carries data-section-key="no-date"
  // (added alongside this button); querying by attribute keeps the
  // jump robust to future class renames during visual refreshes.
  const target = document.querySelector('[data-section-key="no-date"]')
  if (!target) return
  // scrollIntoView puts the target's top edge at viewport top — but
  // the sticky Campaign Log pins to top:0 once the user is below
  // its natural position, so the section header would land BEHIND
  // it (user sees the 2nd undated row at the top, header obscured).
  // Compute the pinned chrome's height at click time and offset the
  // scroll target by exactly that much. Falls back to 0 when the
  // sticky element isn't in the DOM (visibleRecords empty edge case).
  const stickyEl = document.querySelector('.campaign-log-sticky')
  const stickyOffset = stickyEl ? Math.ceil(stickyEl.getBoundingClientRect().height) : 0
  const targetTop = target.getBoundingClientRect().top + window.scrollY - stickyOffset
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.scrollTo({ top: targetTop, behavior: reduce ? 'auto' : 'smooth' })
}
// Single dossier instance per Matches view. provideDossier() makes
// it reachable from every descendant widget via useDossier() so we
// don't thread 18 props through DashboardWidget. Each widget pulls
// only the bedrock refs or query helpers it needs, parameterized
// by its own useWidgetConfig output (PR C). MatchesView's previous
// 18-prop widgetProps bag is gone.
const dossier = useMatchesDossier(narrowedRecords, leaverHandling, ow.heroRole, weekStart)
provideDossier(dossier)

// ─── Dashboard widget layout ────────────────────────────────────
//
// Dossier KPIs and breakdowns are rendered through a registry of
// `<DashboardWidget>` SFCs (see dashboard/widgets.ts). The persisted
// row layout is the SINGLE source of truth for "is this widget
// rendered" — membership in `layout.rows.value[*]` means visible,
// absence means absent. Trash on a widget removes it from the
// layout; the customizer's "+ Add" puts it back.
const dashboardLayout = useDashboardLayout()

// Live-reflow drag preview. Held as a plain ref so it can be
// referenced from `dragReorder.onMove` (declared next) without a
// TDZ tangle — a watcher below keeps it in sync with the drag
// state. While a drag is in flight AND the cursor is over a valid
// drop target, this holds a layout where the dragged widget sits
// at the prospective drop position. Other widgets reflow around
// it via the TransitionGroup's FLIP move transition. On drop the
// preview becomes the persisted layout in one atomic setLayout
// write; on dragend without drop (cursor released off the
// dossier) the preview clears and widgets snap back.
const previewLayout = ref<Record<number, string[]> | null>(null)

// Drag-reorder primitive. Tracks `dragging` (source coords) +
// `dropHint` (the cell the cursor is currently over) reactive
// refs and emits onMove on a successful drop. The onMove handler
// uses previewLayout to choose between "commit the live preview"
// (drag) and "traditional move" (keyboard reorder).
const dragReorder = useDragReorder({
  onMove: (id, fromRow, fromIdx, toRow, toIdx) => {
    const preview = previewLayout.value
    if (preview) {
      // Live-reflow drag: the preview IS the destination. Persist
      // it atomically rather than re-deriving via move().
      dashboardLayout.setLayout(preview)
    } else {
      // Keyboard reorder (no live preview): traditional move.
      dashboardLayout.move(id, fromRow, fromIdx, toRow, toIdx)
    }
  },
  rowSize: (row) => {
    const r = dashboardRows.value.find((x) => x.index === row)
    return r ? r.widgets.length : 0
  },
})

const dashboardRows = computed(() => {
  const layout = previewLayout.value ?? dashboardLayout.rows.value
  return Object.keys(layout)
    .map((k) => Number(k))
    .sort((a, b) => a - b)
    .map((rowIdx) => ({
      index: rowIdx,
      widgets: (layout[rowIdx] ?? [])
        .map((id) => widgetById(id))
        .filter((def): def is WidgetDef => def !== undefined),
    }))
})

// Recompute the preview whenever the drag state changes. Watcher
// flush order is sync→pre→post; default `flush: 'pre'` is fine
// — runs before the next DOM update so dashboardRows sees a
// fresh preview on the same render tick.
watch(
  [dragReorder.dragging, dragReorder.dropHint, dashboardLayout.rows],
  ([dragState, hint, layout]) => {
    if (!dragState || !hint) {
      previewLayout.value = null
      return
    }
    const next: Record<number, string[]> = {}
    for (const [k, v] of Object.entries(layout)) {
      next[Number(k)] = [...v]
    }
    // Remove the dragged widget from wherever it currently lives.
    // Walking every row keeps this robust if the source coords on
    // dragState went stale mid-drag.
    for (const key of Object.keys(next)) {
      const rowIdx = Number(key)
      const arr = next[rowIdx]!
      const idx = arr.indexOf(dragState.id)
      if (idx !== -1) {
        arr.splice(idx, 1)
        next[rowIdx] = arr
        break
      }
    }
    // Insert at the hint position in the target row.
    const targetRow = next[hint.row] ?? []
    const insertAt = Math.max(0, Math.min(hint.idx, targetRow.length))
    targetRow.splice(insertAt, 0, dragState.id)
    next[hint.row] = targetRow
    previewLayout.value = next
  },
  { deep: true },
)

// Edit mode is a sticky checkbox on the dossier header — separate
// from the customizer modal so the user can drag / trash without
// the modal eating the screen, and open the modal as a punctuated
// "add a widget" gesture.
const editMode = ref(false)
const showDashboardCustomizer = ref(false)
const selectedWidgetId = ref<string | null>(null)

// Clear the selection when the user leaves edit mode so re-entering
// doesn't ghost an old selection.
watch(editMode, (v) => {
  if (!v) selectedWidgetId.value = null
})

function onWidgetSelect(id: string) {
  selectedWidgetId.value = id
}

// Gear-popover state. configureWidgetId is the widget whose
// schema-driven settings popover is mounted; configureAnchor is the
// gear button's bounding rect at the time of the click so the
// popover positions next to it. We re-capture the rect on every
// open so resizes / scrolls between selections produce a fresh
// anchor.
const configureWidgetId = ref<string | null>(null)
const configureAnchor   = ref<DOMRect | null>(null)
const configureDef = computed(() =>
  configureWidgetId.value ? widgetById(configureWidgetId.value) ?? null : null,
)

function onWidgetConfigure(id: string, e: MouseEvent) {
  const target = e.currentTarget as HTMLElement | null
  if (!target) return
  configureWidgetId.value = id
  configureAnchor.value   = target.getBoundingClientRect()
}

function closeWidgetConfigure() {
  configureWidgetId.value = null
  configureAnchor.value   = null
}

// Undo registry — captures the widget that was just trashed so the
// undo toast can put it back where it was. We snapshot eyebrow + row
// + idx BEFORE the layout.removeFromRow() call because afterwards
// the registry lookup still works (registry never loses entries) but
// the row/idx context is gone. Token bumps on every fresh trash so
// the toast re-runs its slide-in animation + countdown even for
// back-to-back removes of the same id.
const pendingUndo = ref<{ id: string; eyebrow: string; row: number; idx: number; token: number } | null>(null)
let undoTokenSeq = 0

function onWidgetRemove(id: string) {
  const def = widgetById(id)
  if (!def) return
  // Walk the current layout to find where the widget lives so undo
  // can re-add it at the right spot.
  let foundRow = def.defaultRow
  let foundIdx = 0
  for (const row of dashboardRows.value) {
    const idxInRow = row.widgets.findIndex((w) => w.id === id)
    if (idxInRow !== -1) {
      foundRow = row.index
      foundIdx = idxInRow
      break
    }
  }
  dashboardLayout.removeFromRow(id)
  if (selectedWidgetId.value === id) selectedWidgetId.value = null
  undoTokenSeq++
  pendingUndo.value = {
    id,
    eyebrow: def.eyebrow,
    row: foundRow,
    idx: foundIdx,
    token: undoTokenSeq,
  }
}

function onUndoRemove(token: number) {
  const pending = pendingUndo.value
  if (!pending || pending.token !== token) return
  // appendToRow respects the soft-threshold spill so a row that just
  // shed a widget and is now over-full will spill on undo too. That
  // matches the new-add behavior so the user gets consistent
  // mechanics.
  dashboardLayout.appendToRow(pending.row, pending.id)
  pendingUndo.value = null
}

function onDismissUndo(token: number) {
  if (pendingUndo.value?.token === token) {
    pendingUndo.value = null
  }
}

// PR C: the widget prop bag is gone. Each widget pulls its own
// slice from the provided dossier via useDossier() + its own
// useWidgetConfig() in setup. DashboardWidget binds
// <component :is="def.component" /> with no props.

// Three existing review-widget e2e specs key on data-kpi="..."; the
// roles breakdown spec keys on data-breakdown="roles". Keep the legacy
// attrs on the wrapper during Phase 1; a follow-up PR re-points the
// specs to [data-widget-id="..."] and drops these.
const LEGACY_DATA_KPI: Record<string, string> = {
  'reviewed-count':    'reviewed-count',
  'days-since-review': 'days-since-review',
  'wld-since-review':  'wld-since-review',
}
const LEGACY_DATA_BREAKDOWN: Record<string, string> = {
  'top-roles': 'roles',
}

const setHeadline = computed(() => {
  if (!anyNarrow.value) return 'All matches on record'
  const parts: string[] = []
  if (searchText.value.trim()) parts.push(`"${searchText.value.trim()}"`)
  if (customFrom.value || customTo.value) parts.push(`${customFrom.value || '…'} → ${customTo.value || '…'}`)
  else if (pickedRange.value !== 'all') parts.push(`last ${pickedRange.value}`)
  if (pickedMapTypes.value.size) parts.push([...pickedMapTypes.value].join('/'))
  if (pickedMaps.value.size)     parts.push([...pickedMaps.value].join(' · '))
  if (pickedRoles.value.size)    parts.push([...pickedRoles.value].join('/'))
  if (pickedHeroes.value.size)   parts.push([...pickedHeroes.value].join(' · '))
  if (pickedResults.value.size)  parts.push([...pickedResults.value].join('/'))
  if (pickedTags.value.size)     parts.push([...pickedTags.value].map((t) => `#${t}`).join(' '))
  return parts.join(' — ') || 'Active narrow'
})

const setSubline = computed(() => {
  const n = narrowedRecords.value.length
  if (!anyNarrow.value) return 'spans your full history'
  return `${n} of ${props.records.length} matches in this view`
})

// ─── Sort + group via useMatchesGroup composable ───────────
const { sortedRecords, groupedSections } = useMatchesGroup(narrowedRecords, groupBy, sortOrder)

// ─── Infinite-scroll window over the grouped sections ──────
//
// Renders only the first `renderedCount` rows; an
// IntersectionObserver sentinel below the rendered set bumps the
// window by another page when the user scrolls into it. Reset
// triggers (narrow change, sort change, group change, parse
// refresh) snap back to one page + scroll the list to top via
// the resetCounter watcher below. See the useMatchesWindow doc
// comment for why we window client-side rather than HTTP-page.
const focusedCardIndexRef = computed(() => props.focusedCardIndex ?? -1)
const {
  renderedCount,
  hasMore,
  bumpWindow,
  expandWindowToAll,
  resetCounter,
} = useMatchesWindow(narrowedRecords, [sortOrder, groupBy], focusedCardIndexRef)

// Slice groupedSections at renderedCount total rows. Headers are
// free (they don't count toward the cap); a section that runs
// over the budget keeps only the first K rows; sections past the
// cap drop entirely so we don't render a dangling header.
const windowedSections = computed<GroupedSection[]>(() => {
  const cap = renderedCount.value
  const out: GroupedSection[] = []
  let used = 0
  for (const s of groupedSections.value) {
    if (used >= cap) break
    const remaining = cap - used
    if (s.records.length <= remaining) {
      out.push(s)
      used += s.records.length
    } else {
      out.push({ key: s.key, header: s.header, records: s.records.slice(0, remaining) })
      break
    }
  }
  return out
})

// IntersectionObserver wiring lives in onMounted/onBeforeUnmount
// at the bottom of this script block — keeps the DOM-touching
// concern co-located with the leavesListRef declaration.
const leavesListRef = ref<HTMLUListElement | null>(null)
const sentinelRef   = ref<HTMLLIElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null

// Sticky Campaign Log state. The sentinel sits just above the
// timeline at its natural position; the scroll listener flips
// `timelineSticky` true when the sentinel's clientRect.top goes
// below 0 (i.e. it has scrolled past the viewport top), and the
// wrapper renders in compact mode. Scroll-driven rather than
// IntersectionObserver-driven because the sentinel sits BELOW
// the viewport on initial load (dossier widget grid pushes it
// down) and `!isIntersecting` alone fires a false-positive
// sticky in that case.
const timelineSentinelRef = ref<HTMLDivElement | null>(null)
const timelineSticky      = ref(false)
function onTimelineScroll() {
  const el = timelineSentinelRef.value
  if (!el) return
  timelineSticky.value = el.getBoundingClientRect().top < 0
}

// Reset → scroll the leaves list back to the top. Keeps the
// scrolling concern in the view (where the ref lives) rather
// than making useMatchesWindow DOM-aware. Pre-fix UX without
// this: applying a filter that shrinks the set left the
// scrollbar at the original position, which was disorienting.
watch(resetCounter, () => {
  leavesListRef.value?.scrollTo({ top: 0, behavior: 'auto' })
})

// Index every visible leaf-row by its position in narrowedRecords so
// App.vue's j/k keyboard nav (which walks `matchesNarrow.narrowedRecords`)
// can target the matching .leaf-row via `data-card-index`. The order
// matches App.vue's iteration; for `sortOrder='newest'` (the default)
// + a typical date-descending corpus the rendered order also matches,
// so `j` advances down the visible list.
const narrowedIndexByKey = computed(() => {
  const m = new Map<string, number>()
  narrowedRecords.value.forEach((r, i) => m.set(r.match_key, i))
  return m
})

// "Since anchor" — look up the anchored match from the full corpus
// (NOT narrowedRecords, which excludes the anchor itself when the
// filter is active). Returns null when the anchor key is unset OR
// points at a deleted match. Drives both the active-chip label and
// the narrow-panel section copy.
const anchorRecord = computed(() => {
  if (anchorKey.value === '') return null
  return props.records.find((r) => r.match_key === anchorKey.value) ?? null
})

const anchorChipLabel = computed(() => {
  const r = anchorRecord.value
  if (!r) return ''
  const d = r.data?.date ?? ''
  const map = r.data?.map ?? '—'
  return d ? `${d} · ${map}` : map
})

// Row right-click → context menu with quick actions ("Open detail",
// "Filter from this match" / "Clear since-anchor"). Coordinates come
// from the native MouseEvent's clientX / clientY so the menu pops up
// right under the cursor.
const rowContextMenu = ref<{ x: number; y: number; matchKey: string } | null>(null)

function onRowContext(e: MouseEvent, matchKey: string) {
  e.preventDefault()
  rowContextMenu.value = { x: e.clientX, y: e.clientY, matchKey }
}

function onRowContextClose() {
  rowContextMenu.value = null
}

function onRowContextOpenDetail(matchKey: string) {
  emit('open-match', matchKey)
}

function onRowContextSetAnchor(matchKey: string) {
  emit('set-anchor', matchKey)
}

function onRowContextHide(matchKey: string) {
  // Reuses the bulk hide event with a single-key array — same code
  // path the bulk-action bar drives, so the existing
  // SetMatchVisibility(true) + reload + undo-via-detail-panel
  // works without a new App.vue handler.
  emit('hide-matches', [matchKey])
}

function formatTime(rec: MatchRecord): string {
  return rec.data?.finished_at ?? ''
}

// Comma-separated hero list, most-played first. Commas pick over
// `|` because the row reads as a natural-language label first and
// a table cell second; `,` matches English list convention. If
// the primary hero (`data.hero`) isn't represented in
// `heroes_played` (an OCR edge case), include it at the end of
// the list so the user always sees the parsed primary. Falls back
// to `—` only when both `heroes_played` is empty AND there's no
// primary hero.
function formatHeroes(rec: MatchRecord): string {
  const played = [...(rec.data?.heroes_played ?? [])]
  const primary = rec.data?.hero
  if (primary && !played.some((h) => h.hero === primary)) {
    played.push({ hero: primary, percent_played: 0 })
  }
  if (played.length === 0) return '—'
  const sorted = played.sort(
    (a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0),
  )
  return sorted.map((h) => h.hero).filter(Boolean).join(', ')
}

// Role label for the leaf row. Open-queue matches let a player
// touch multiple roles; we list every role the heroes_played array
// resolved to, in percent-played order, deduped. Single-role
// matches fall through to a single label (no comma). Returns ''
// when neither heroes_played nor data.role resolve — the caller's
// v-if drops the chip in that case.
function formatRoles(rec: MatchRecord): string {
  return rolesForHeader(rec, ow.heroRole).join(', ')
}

function formatRowDate(rec: MatchRecord): string {
  const d = rec.data?.date
  if (!d) return '—'
  const dt = new Date(d + 'T00:00:00')
  if (isNaN(dt.getTime())) return d
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ─── Narrow popover plumbing ─────────────────────────────
//
// The popover itself (template + focus trap + outside-click
// handler + '/' keyboard shortcut + combobox state) lives in
// NarrowPopover.vue — all that's left here is the trigger button
// + the open ref + the trigger ref the popover needs for the
// outside-click exemption.
const triggerRef = ref<HTMLElement | null>(null)

function toggleNarrow() {
  narrowOpen.value = !narrowOpen.value
}

onMounted(() => {
  // Fetch the profile list once for the Move-to picker. Failures
  // silently leave availableProfiles empty, which suppresses the
  // Move-to button — gracefully degrades to the original bulk action
  // bar instead of surfacing a broken affordance.
  GetProfiles().then((res) => { availableProfiles.value = res }).catch(() => undefined)

  // IntersectionObserver for the infinite-scroll sentinel. The
  // sentinel only mounts while `hasMore` is true, so we watch
  // the ref and re-observe on (re)mount. `rootMargin: 300px`
  // pre-loads the next page just before the user reaches the
  // tail, which feels instant on a desktop scroll wheel.
  watch(sentinelRef, (el, prev) => {
    if (prev && sentinelObserver) sentinelObserver.unobserve(prev)
    if (!el) return
    if (!sentinelObserver) {
      // Root = null (document viewport). Using the leaves-list as
      // the root would always classify the sentinel as
      // "intersecting" — the list has no overflow boundary, so
      // its bounding-client-rect always contains the sentinel.
      // The viewport is the natural scroll container for this
      // app. rootMargin pre-loads the next page just before the
      // user reaches the tail so the new rows are already
      // composited when they swing into view.
      sentinelObserver = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) bumpWindow()
          }
        },
        { root: null, rootMargin: '200px' },
      )
    }
    sentinelObserver.observe(el)
  }, { immediate: true })

  window.addEventListener('scroll', onTimelineScroll, { passive: true })
  // Run once at mount + after the sentinel renders so the initial
  // state is correct even if the user lands mid-scroll (e.g. an
  // anchor link).
  watch(timelineSentinelRef, onTimelineScroll, { immediate: true, flush: 'post' })
})

onBeforeUnmount(() => {
  sentinelObserver?.disconnect()
  sentinelObserver = null
  window.removeEventListener('scroll', onTimelineScroll)
})
</script>

<template>
  <section
    id="panel-matches"
    role="tabpanel"
    aria-labelledby="tab-matches"
    tabindex="-1"
    class="matches-set-workspace"
    :class="{ 'matches-set-workspace-rail': narrowMode === 'rail' }"
  >
    <!-- Rail-mode filter panel — peer column on the left of the
         workspace at width >= 1400 px. In popover mode this slot is
         empty and the historical trigger-button + teleported modal
         render in their original location inside the dossier
         actions row. -->
    <NarrowPopover
      v-if="narrowMode === 'rail'"
      mode="rail"
      :open="true"
      :narrow="props.narrow"
      :records="props.records"
      @open-match="(k: string) => emit('open-match', k)"
      @clear-anchor="emit('clear-anchor')"
    />

    <div class="matches-content-column">
    <!-- ─── SET DOSSIER ─────────────────────────────────────── -->
    <section
      class="set-dossier"
      :class="{ 'set-dossier-editing': editMode }"
      aria-label="Set dossier"
    >
      <DashboardEditBanner
        :open="editMode"
        @exit="editMode = false"
        @reset="dashboardLayout.reset()"
      />
      <header class="dossier-head">
        <span class="dossier-eyebrow">{{ anyNarrow ? 'Narrowed set' : 'Set' }}</span>
        <h2 class="dossier-title">
          {{ setHeadline }}
        </h2>
        <span class="dossier-meta">{{ setSubline }}</span>

        <ul v-if="anyNarrow" class="active-chips" aria-label="Active narrowing clauses">
          <li v-if="searchText.trim()" class="active-chip search">
            <span class="chip-key">Search</span>
            <span class="chip-val">"{{ searchText.trim() }}"</span>
            <button class="chip-x" aria-label="Clear search" @click="searchText = ''">
              ×
            </button>
          </li>
          <li v-if="pickedRange !== 'all' && !customFrom && !customTo" class="active-chip range">
            <span class="chip-key">Range</span>
            <span class="chip-val">last {{ pickedRange }}</span>
            <button class="chip-x" aria-label="Drop range" @click="pickRange('all')">
              ×
            </button>
          </li>
          <li v-if="customFrom || customTo" class="active-chip range">
            <span class="chip-key">Dates</span>
            <span class="chip-val">{{ customFrom || '…' }} → {{ customTo || '…' }}</span>
            <button class="chip-x" aria-label="Clear dates" @click="customFrom = ''; customTo = ''; pickedRange = 'all'">
              ×
            </button>
          </li>
          <li v-for="m in [...pickedMaps]" :key="`m-${m}`" class="active-chip">
            <span class="chip-key">Map</span>
            <span class="chip-val">{{ m }}</span>
            <button class="chip-x" :aria-label="`Drop map ${m}`" @click="pickMap(m)">
              ×
            </button>
          </li>
          <li v-for="t in [...pickedMapTypes]" :key="`mt-${t}`" class="active-chip">
            <span class="chip-key">Type</span>
            <span class="chip-val">{{ t }}</span>
            <button class="chip-x" :aria-label="`Drop type ${t}`" @click="pickMapType(t)">
              ×
            </button>
          </li>
          <li v-for="h in [...pickedHeroes]" :key="`h-${h}`" class="active-chip">
            <span class="chip-key">Hero</span>
            <span class="chip-val">{{ h }}</span>
            <button class="chip-x" :aria-label="`Drop hero ${h}`" @click="pickHero(h)">
              ×
            </button>
          </li>
          <li v-for="r in [...pickedRoles]" :key="`r-${r}`" class="active-chip">
            <span class="chip-key">Role</span>
            <span class="chip-val">{{ r }}</span>
            <button class="chip-x" :aria-label="`Drop role ${r}`" @click="pickRole(r)">
              ×
            </button>
          </li>
          <li v-for="r in [...pickedResults]" :key="`res-${r}`" class="active-chip">
            <span class="chip-key">Result</span>
            <span class="chip-val">{{ r }}</span>
            <button class="chip-x" :aria-label="`Drop result ${r}`" @click="pickResult(r)">
              ×
            </button>
          </li>
          <li v-for="t in [...pickedTags]" :key="`tg-${t}`" class="active-chip">
            <span class="chip-key">Tag</span>
            <span class="chip-val">#{{ t }}</span>
            <button class="chip-x" :aria-label="`Drop tag ${t}`" @click="pickTag(t)">
              ×
            </button>
          </li>
          <li v-if="leaverHandling !== 'include'" class="active-chip">
            <span class="chip-key">Leavers</span>
            <span class="chip-val">{{ leaverHandling === 'hide' ? 'hidden' : 'no tally' }}</span>
            <button class="chip-x" aria-label="Reset leavers" @click="leaverHandling = 'include'">
              ×
            </button>
          </li>
          <li v-if="minPlayMinutes > 0" class="active-chip">
            <span class="chip-key">Min play</span>
            <span class="chip-val">≥ {{ minPlayMinutes }}m</span>
            <button class="chip-x" aria-label="Reset min play minutes" @click="minPlayMinutes = 0">
              ×
            </button>
          </li>
          <li v-if="minPlayPercent > 0" class="active-chip">
            <span class="chip-key">Min played</span>
            <span class="chip-val">≥ {{ minPlayPercent }}%</span>
            <button class="chip-x" aria-label="Reset min play percent" @click="minPlayPercent = 0">
              ×
            </button>
          </li>
          <li v-if="includeUnknown" class="active-chip">
            <span class="chip-key">Unknown</span>
            <span class="chip-val">shown</span>
            <button class="chip-x" aria-label="Hide unknown" @click="includeUnknown = false">
              ×
            </button>
          </li>
          <li
            v-for="b in [...pickedReviewedBy]"
            :key="`rb-${b}`"
            class="active-chip"
          >
            <span class="chip-key">Reviewed by</span>
            <span class="chip-val">{{ b }}</span>
            <button class="chip-x" :aria-label="`Drop ${b}`" @click="pickReviewedBy(b)">
              ×
            </button>
          </li>
          <li v-if="sinceAnchorActive && anchorRecord" class="active-chip">
            <span class="chip-key">Since</span>
            <span class="chip-val">{{ anchorChipLabel }}</span>
            <button
              class="chip-x"
              aria-label="Stop filtering since anchor"
              @click="sinceAnchorActive = false"
            >
              ×
            </button>
          </li>
          <li class="active-chip clear">
            <button class="chip-clear" @click="resetNarrow">
              Clear all
            </button>
          </li>
        </ul>
      </header>

      <template v-for="row in dashboardRows" :key="`row-${row.index}`">
        <TransitionGroup
          tag="div"
          class="dashboard-row"
          name="dashboard-widget"
          :data-row="row.index"
          @dragover.prevent="editMode ? dragReorder.onRowDragOver(row.index, $event) : null"
          @drop="editMode ? dragReorder.onRowDrop(row.index, $event) : null"
        >
          <DashboardWidget
            v-for="(def, idx) in row.widgets"
            :id="def.id"
            :key="def.id"
            :shape="def.shape"
            :edit-mode="editMode"
            :row="row.index"
            :idx="idx"
            :selected="editMode && selectedWidgetId === def.id"
            :has-config="def.config.fields.length > 0"
            :dragging="dragReorder.dragging.value !== null
              && dragReorder.dragging.value.id === def.id"
            :drop-target="dragReorder.dropHint.value !== null &&
              dragReorder.dropHint.value.row === row.index &&
              dragReorder.dropHint.value.idx === idx"
            :legacy-data-kpi="LEGACY_DATA_KPI[def.id]"
            :legacy-data-breakdown="LEGACY_DATA_BREAKDOWN[def.id]"
            @drag-start="dragReorder.onDragStart"
            @drag-end="dragReorder.onDragEnd"
            @drag-over="dragReorder.onDragOver"
            @drop="dragReorder.onDrop"
            @handle-keydown="dragReorder.onHandleKeydown"
            @select="onWidgetSelect"
            @remove="onWidgetRemove"
            @configure="onWidgetConfigure"
          >
            <component :is="def.component" />
          </DashboardWidget>
        </TransitionGroup>
      </template>
      <!-- "+" tile lives in its own dedicated row below every
           widget row so it can never collide with widget controls
           (trash buttons / drag affordances) and stays prominent
           even when the last widget row is a tightly-packed
           overflow. Rendered only in edit mode. -->
      <div v-if="editMode" class="dashboard-add-row">
        <DashboardAddTile @click="showDashboardCustomizer = true" />
      </div>

      <!-- Narrow trigger + popover. -->
      <div class="dossier-actions">
        <!-- Edit-dashboard sticky toggle, rendered as a pill switch
             with discrete VIEW / EDIT states. The native checkbox is
             visually hidden but keyboard- and screen-reader-reachable;
             the styled track + thumb give the affordance + state
             readout for sighted users. Lights up direct-manipulation
             chrome (whole-widget drag, hover-revealed trash + grip,
             "+" tile at the row tail). -->
        <label class="dossier-edit-switch" :class="{ 'is-on': editMode }">
          <input
            v-model="editMode"
            type="checkbox"
            class="dossier-edit-switch-input"
            data-edit-toggle
            :aria-label="editMode ? 'Exit dashboard edit mode' : 'Enter dashboard edit mode'"
          >
          <span class="dossier-edit-switch-track" aria-hidden="true">
            <span class="dossier-edit-switch-segment" data-state="view">View</span>
            <span class="dossier-edit-switch-segment" data-state="edit">Edit</span>
            <span class="dossier-edit-switch-thumb" />
          </span>
        </label>

        <!-- Popover-mode trigger + modal. Hidden when the rail is
             rendering instead (>= 1400 px viewport). -->
        <div v-if="narrowMode === 'popover'" class="narrow-anchor">
          <button
            ref="triggerRef"
            class="dossier-btn primary"
            :class="{ 'is-open': narrowOpen }"
            :aria-expanded="narrowOpen ? 'true' : 'false'"
            aria-haspopup="true"
            aria-controls="narrow-popover"
            data-narrow-trigger
            @click="toggleNarrow"
          >
            <span aria-hidden="true">⌗</span> Narrow this set
            <span v-if="anyNarrow" class="narrow-count">· {{ activeClauseCount }}</span>
          </button>

          <NarrowPopover
            v-model:open="narrowOpen"
            mode="popover"
            :narrow="props.narrow"
            :records="props.records"
            :trigger-el="triggerRef"
            @open-match="(k: string) => emit('open-match', k)"
            @clear-anchor="emit('clear-anchor')"
            @narrow-open="(v: boolean) => emit('narrow-open', v)"
          />
        </div>
      </div>

      <!-- Customizer modal lives at the end of the dossier so its
           Teleport target (body) lifts it above every dossier-local
           ancestor stacking context. -->
      <DashboardCustomizer
        :open="showDashboardCustomizer"
        @close="showDashboardCustomizer = false"
      />

      <!-- Undo-after-trash toast. Itself teleports to <body> so it
           lives outside any inert/aria-hidden ancestors. -->
      <DashboardUndoToast
        :trashed="pendingUndo"
        @undo="onUndoRemove"
        @dismiss="onDismissUndo"
      />

      <!-- Per-widget settings popover. Teleports to <body>; anchored
           to the gear-button rect captured on click. -->
      <WidgetConfigPopover
        :open="configureWidgetId !== null"
        :def="configureDef"
        :anchor="configureAnchor"
        @close="closeWidgetConfigure"
      />

      <!-- Combined Sort + Group dropdown. Mounted at the section
           level so its z-index sits above the leaves list. The
           trigger's bounding rect is captured on click; close on
           Esc / outside-click / radio-pick. -->
      <MatchesSortGroupPopover
        :open="sortGroupOpen"
        :sort="sortOrder"
        :group="groupBy"
        :anchor="sortGroupAnchor"
        @close="closeSortGroup"
        @update:sort="(v) => { sortOrder = v }"
        @update:group="(v) => { groupBy = v }"
      />
    </section>

    <!-- ─── CAMPAIGN LOG (heatmap + sparkline) ──────────────── -->
    <!-- `visibleRecords` strips hidden matches so the heatmap and
         sparkline reconcile with the dossier / scrapeReader — every
         data surface honours the user's "this match doesn't count"
         signal in lockstep.

         Sticky wrapper: the sentinel below sits at the natural
         position; once it scrolls out of the viewport the
         IntersectionObserver flips `timelineSticky` true and the
         timeline renders in compact mode (heatmap hidden, window
         buttons hidden, sparkline at compact height). The wrapper
         itself is position: sticky so the whole bar pins to the
         scroll container's top edge. -->
    <div v-if="visibleRecords.length > 0" ref="timelineSentinelRef" class="campaign-log-sentinel" aria-hidden="true" />
    <div
      v-if="visibleRecords.length > 0"
      class="campaign-log-sticky"
      :class="{ 'campaign-log-pinned': timelineSticky }"
    >
      <MatchTimelineHeader
        :records="visibleRecords"
        :filter-from="customFrom"
        :filter-to="customTo"
        :compact="timelineSticky"
        @update:filter-from="(v: string) => { customFrom = v; pickedRange = 'custom' }"
        @update:filter-to="(v: string) => { customTo = v; pickedRange = 'custom' }"
      />
    </div>

    <!-- ─── MEMBERS ─────────────────────────────────────────── -->
    <section class="leaves" aria-label="Set members">
      <header class="leaves-head">
        <div class="leaves-head-left">
          <span class="leaves-eyebrow">Members</span>
          <h3 class="leaves-title">
            {{ sortedRecords.length }} matches in this set
          </h3>
        </div>
        <div class="leaves-head-controls">
          <button
            type="button"
            class="sort-group-trigger"
            :class="{ open: sortGroupOpen }"
            data-sort-group-trigger
            aria-haspopup="dialog"
            :aria-expanded="sortGroupOpen ? 'true' : 'false'"
            :title="`Sort and group — currently ${sortGroupLabel}`"
            @click="onSortGroupTriggerClick"
          >
            <span class="sort-group-label">{{ sortGroupLabel }}</span>
            <span class="sort-group-caret" aria-hidden="true">▾</span>
          </button>
          <fieldset class="seg" aria-label="Row density">
            <legend class="seg-legend">
              Density
            </legend>
            <button
              class="seg-btn"
              :class="{ picked: density === 'comfortable' }"
              :aria-pressed="density === 'comfortable' ? 'true' : 'false'"
              :data-density-pick="density === 'comfortable' ? 'comfortable' : undefined"
              title="Roomy row spacing"
              @click="setDensity('comfortable')"
            >
              Cozy
            </button>
            <button
              class="seg-btn"
              :class="{ picked: density === 'compact' }"
              :aria-pressed="density === 'compact' ? 'true' : 'false'"
              :data-density-pick="density === 'compact' ? 'compact' : undefined"
              title="Tighter row spacing — more rows per screen"
              @click="setDensity('compact')"
            >
              Compact
            </button>
          </fieldset>
          <!-- Jump to the "No date" section at the bottom of the
               leaves list. useMatchesGroup always appends the
               undated bucket last, regardless of sort order; this
               button gives the user a one-click path to triage
               those rows without scrolling past the dated corpus.
               Disabled (predictable layout > collapsed layout) when
               there are no undated matches in the current narrow. -->
          <button
            type="button"
            class="btn ghost jump-to-undated"
            :class="{ 'has-undated': undatedCount > 0 }"
            :disabled="undatedCount === 0"
            :title="undatedCount === 0
              ? 'No undated matches in this view'
              : `Jump to ${undatedCount} undated match${undatedCount === 1 ? '' : 'es'}`"
            data-jump-to-undated
            @click="onJumpToUndated"
          >
            <span class="jump-glyph" aria-hidden="true">↓</span>
            {{ undatedCount }} undated
          </button>
        </div>
      </header>

      <!-- Bulk action bar — appears as soon as any row is ticked. No
           mode toggle: the checkbox on each row IS the affordance
           (Gmail / Linear / GitHub Issues pattern). Sticky within the
           section so it follows the user down the leaves list. -->
      <BulkActionBar
        v-if="selectedKeys.size > 0"
        :selected-count="selectedKeys.size"
        :sorted-count="sortedRecords.length"
        :other-profiles="otherProfiles"
        :move-picker-open="movePickerOpen"
        @select-all="selectAllVisible"
        @hide="hideSelected"
        @export-bundle="emit('export-bundle', [...selectedKeys])"
        @move-begin="beginMoveLive"
        @move-commit="commitMove"
        @move-cancel="cancelMove"
        @clear="clearSelection"
        @bulk-play-mode="onBulkPlayMode"
        @bulk-queue="onBulkQueue"
      />

      <ul
        v-if="sortedRecords.length"
        ref="leavesListRef"
        class="leaves-list"
        :class="`density-${density}`"
        role="list"
      >
        <template v-for="section in windowedSections" :key="section.key">
          <li v-if="section.header" class="section-divider" :data-section-key="section.key" :aria-label="`Group: ${section.header}`">
            <span class="sd-label">{{ section.header }}</span>
            <span class="sd-count">{{ section.records.length }}</span>
            <span class="sd-line" aria-hidden="true" />
          </li>
          <li
            v-for="rec in section.records"
            :key="rec.match_key"
            class="leaf-row"
            tabindex="-1"
            :data-match-key="rec.match_key"
            :data-card-index="narrowedIndexByKey.get(rec.match_key) ?? -1"
            :aria-current="props.focusedCardIndex !== undefined
              && narrowedIndexByKey.get(rec.match_key) === props.focusedCardIndex
              ? 'true' : undefined"
            :class="[
              `result-${rec.data?.result || 'unknown'}`,
              {
                'has-selection': selectedKeys.size > 0,
                'is-ticked': selectedKeys.has(rec.match_key),
                'kbd-focused': props.focusedCardIndex !== undefined
                  && narrowedIndexByKey.get(rec.match_key) === props.focusedCardIndex,
                'is-anchor': rec.match_key === anchorKey,
              },
            ]"
            @click="emit('open-match', rec.match_key)"
            @contextmenu="onRowContext($event, rec.match_key)"
          >
            <!-- Anchor indicator — a small filled-diamond glyph that
                 shows when this row is the "since this match" anchor.
                 Sits in the absolute corner so it doesn't push other
                 cells. The .is-anchor class on the row also adds a
                 left-edge accent stripe via app.css. -->
            <span
              v-if="rec.match_key === anchorKey"
              class="leaf-anchor-pin"
              aria-label="Current “since” anchor"
              title="This match is the current “since” anchor."
              data-leaf-anchor-pin
            >◆</span>
            <!-- Contextual checkbox — always in the DOM so the row
                 geometry never jumps. Visually faint when idle, full-
                 opacity on row hover / focus / when ticked / when ANY
                 row is ticked. Click stops propagation so the row
                 still opens the detail panel on body click. -->
            <button
              type="button"
              class="leaf-checkbox"
              role="checkbox"
              :aria-checked="selectedKeys.has(rec.match_key) ? 'true' : 'false'"
              :aria-label="`Select match ${rec.match_key}`"
              @click.stop="toggleSelected(rec.match_key)"
            >
              <span class="leaf-checkbox-glyph" aria-hidden="true">{{ selectedKeys.has(rec.match_key) ? '✓' : '' }}</span>
            </button>

            <!-- 1. Result-tinted color strip — instant scan target. -->
            <span class="leaf-strip" aria-hidden="true" />

            <!-- 2. When — date over time. -->
            <div class="leaf-when">
              <span class="leaf-when-date">{{ formatRowDate(rec) }}</span>
              <span class="leaf-when-time">{{ formatTime(rec) }}</span>
            </div>

            <!-- 3. Where — map (display font) over a pair of chips:
                 play mode (Quickplay / Competitive / Unknown mode) +
                 queue type (Role Queue / Open Queue / Unknown mode
                 type). Both chips always render so a glance down the
                 column stays aligned even when the underlying field
                 hasn't been set yet. -->
            <div class="leaf-map-block">
              <span
                v-if="isMapUnknown(rec)"
                class="leaf-map leaf-map-unknown"
                :data-unknown-map="rec.data?.map_raw || true"
                :title="`The parser couldn't match the OCR'd map text to maps.yaml. Wait for the next release to recognise it. (OCR read: ${rec.data?.map_raw ?? '—'})`"
              >{{ formatUnknownMapLabel(rec) }}</span>
              <span v-else class="leaf-map">{{ rec.data?.map || 'unknown' }}</span>
              <span class="leaf-mode-row">
                <span class="leaf-mode-chip">{{ formatPlayModeLabel(rec) }}</span>
                <span class="leaf-queue-chip">{{ formatQueueTypeLabel(rec) }}</span>
              </span>
            </div>

            <!-- 4. Who — hero over role. Open-queue matches can mix
                 support / tank / dps in one game; formatRoles lists
                 every role the heroes_played array resolved to in
                 percent-played order, deduped. Unknown heroes (OCR
                 captured but no canonical match in heroes.yaml) get
                 a warning-styled chip with the raw OCR in parens. -->
            <div class="leaf-hero-block">
              <span
                v-if="isHeroUnknown(rec)"
                class="leaf-hero leaf-hero-unknown"
                :data-unknown-hero="rec.data?.hero_raw || true"
                :title="`The parser couldn't match the OCR'd hero text to heroes.yaml. Wait for the next release to recognise it. (OCR read: ${rec.data?.hero_raw ?? '—'})`"
              >{{ formatUnknownHeroLabel(rec) }}</span>
              <span v-else class="leaf-hero">{{ formatHeroes(rec) }}</span>
              <span v-if="formatRoles(rec)" class="leaf-role">{{ formatRoles(rec) }}</span>
            </div>

            <!-- 5. How — eliminations / assists / deaths, big + bold. -->
            <div class="leaf-stats-block" :aria-label="`Eliminations ${rec.data?.eliminations ?? '?'}, assists ${rec.data?.assists ?? '?'}, deaths ${rec.data?.deaths ?? '?'}`">
              <span class="stat-num">{{ rec.data?.eliminations ?? '—' }}</span>
              <span class="stat-sep" aria-hidden="true">/</span>
              <span class="stat-num">{{ rec.data?.assists ?? '—' }}</span>
              <span class="stat-sep" aria-hidden="true">/</span>
              <span class="stat-num stat-deaths">{{ rec.data?.deaths ?? '—' }}</span>
            </div>

            <!-- 6. Annotations — leaver + tags. Empty when none. -->
            <div class="leaf-meta-block">
              <span v-if="rec.annotation?.leaver" class="leaf-leaver" :title="`Leaver: ${rec.annotation.leaver}`">L</span>
              <span
                v-for="t in rec.annotation?.tags ?? []"
                :key="t"
                class="leaf-tag"
              >#{{ t }}</span>
            </div>

            <!-- 7. Outcome chip — anchored to the right edge. -->
            <span class="leaf-result-chip" :class="`result-${rec.data?.result || 'unknown'}`">
              {{ rec.data?.result || '—' }}
            </span>
          </li>
        </template>
        <!-- Infinite-scroll sentinel. Observed by an
             IntersectionObserver wired in onMounted; entering the
             viewport bumps the window by another page. Hidden
             from a11y because the announcement comes through
             the leaves-foot status line below. -->
        <li
          v-if="hasMore"
          ref="sentinelRef"
          class="leaves-sentinel"
          aria-hidden="true"
          data-testid="leaves-sentinel"
        />
        <!-- Honest count for screen readers AND sighted users.
             role="status" + aria-live="polite" so the running
             total announces softly as the window grows. -->
        <li
          class="leaves-foot"
          role="status"
          aria-live="polite"
          data-testid="leaves-foot"
        >
          <span v-if="hasMore">
            Showing {{ renderedCount }} of {{ sortedRecords.length }} matches
          </span>
          <span v-else>
            Showing all {{ sortedRecords.length }}
            {{ sortedRecords.length === 1 ? 'match' : 'matches' }}
          </span>
        </li>
      </ul>
      <p v-else class="leaves-empty">
        No matches in this set.
        <button v-if="anyNarrow" class="leaves-empty-btn" @click="resetNarrow">
          Clear narrowing
        </button>
      </p>
    </section>

    <!-- ─── HIDDEN DRAWER (Archive) ──────────────────────────
         Collapsed by default. Surfaces a count chip in the header.
         Body lists every record whose `hidden` flag is set on the
         parent props.records (which the dossier / heatmap /
         sparkline / scrapeReader all already drop). Each row offers
         Unhide (returns it to the active set) and Delete forever
         (two-step affordance; second click hard-deletes from DB). -->
    <section
      v-if="hiddenRecords.length > 0 || archiveOpen"
      class="archive"
      aria-label="Hidden matches archive"
    >
      <button
        type="button"
        class="archive-toggle"
        :aria-expanded="archiveOpen ? 'true' : 'false'"
        aria-controls="archive-panel"
        @click="archiveOpen = !archiveOpen"
      >
        <span class="archive-eyebrow">Archive</span>
        <span class="archive-title">
          <span class="archive-count">{{ hiddenRecords.length }}</span>
          <span class="archive-noun">hidden {{ hiddenRecords.length === 1 ? 'match' : 'matches' }}</span>
        </span>
        <span class="archive-chev" :class="{ open: archiveOpen }" aria-hidden="true">▾</span>
      </button>

      <div v-if="archiveOpen" id="archive-panel" class="archive-panel">
        <p v-if="hiddenRecords.length === 0" class="archive-empty">
          Archive is empty.
        </p>

        <!-- Archive bulk action bar — same contextual pattern as the
             live leaves list. Appears as soon as any archive row is
             ticked. Bulk Delete forever uses an inline two-step
             confirm because it's irreversible. -->
        <div
          v-if="archiveSelectedKeys.size > 0"
          class="archive-action-bar"
          role="region"
          aria-label="Archive bulk action bar"
        >
          <span class="bab-glyph" aria-hidden="true">▣</span>
          <span class="bab-count">{{ archiveSelectedKeys.size }} selected</span>
          <span class="bab-spacer" aria-hidden="true" />
          <template v-if="!archiveBulkConfirm && movePickerOpen !== 'archive'">
            <button
              v-if="archiveSelectedKeys.size < hiddenRecords.length"
              type="button"
              class="bulk-select-all"
              @click="selectAllArchive"
            >
              Select all ({{ hiddenRecords.length }})
            </button>
            <button type="button" class="bulk-unhide" @click="unhideSelectedArchive">
              Unhide
            </button>
            <button
              v-if="otherProfiles.length > 0"
              type="button"
              class="bulk-move"
              @click="beginMoveArchive"
            >
              Move to…
            </button>
            <button type="button" class="bulk-delete" @click="requestBulkHardDelete">
              Delete forever
            </button>
            <button type="button" class="bulk-cancel" @click="clearArchiveSelection">
              Clear
            </button>
          </template>
          <template v-else-if="movePickerOpen === 'archive'">
            <span class="bab-prompt">Move to:</span>
            <button
              v-for="p in otherProfiles"
              :key="p"
              type="button"
              class="bulk-move-target"
              @click="commitMove(p)"
            >
              {{ p }}
            </button>
            <button type="button" class="bulk-cancel" @click="cancelMove">
              Cancel
            </button>
          </template>
          <template v-else>
            <span class="bab-warn" aria-hidden="true">⚠</span>
            <span class="bab-warn-text">
              Delete {{ archiveSelectedKeys.size }} {{ archiveSelectedKeys.size === 1 ? 'match' : 'matches' }} from the database?
            </span>
            <button type="button" class="bulk-confirm" @click="commitBulkHardDelete">
              Confirm
            </button>
            <button type="button" class="bulk-cancel" @click="cancelBulkHardDelete">
              Cancel
            </button>
          </template>
        </div>

        <ul v-if="hiddenRecords.length > 0" class="archive-list" role="list">
          <li
            v-for="rec in hiddenRecords"
            :key="rec.match_key"
            class="archive-row"
            :class="[
              `result-${rec.data?.result || 'unknown'}`,
              { 'has-selection': archiveSelectedKeys.size > 0, 'is-ticked': archiveSelectedKeys.has(rec.match_key) },
            ]"
          >
            <button
              type="button"
              class="archive-checkbox"
              role="checkbox"
              :aria-checked="archiveSelectedKeys.has(rec.match_key) ? 'true' : 'false'"
              :aria-label="`Select hidden match ${rec.match_key}`"
              @click.stop="toggleArchiveSelected(rec.match_key)"
            >
              <span class="archive-checkbox-glyph" aria-hidden="true">{{ archiveSelectedKeys.has(rec.match_key) ? '✓' : '' }}</span>
            </button>
            <span class="archive-row-strip" aria-hidden="true" />
            <div class="archive-row-when">
              <span class="archive-row-date">{{ formatRowDate(rec) }}</span>
              <span class="archive-row-time">{{ formatTime(rec) }}</span>
            </div>
            <div class="archive-row-map">
              <span class="archive-row-map-name">{{ rec.data?.map || 'unknown' }}</span>
              <span class="archive-row-mode">{{ formatPlayModeLabel(rec) }}</span>
              <span class="archive-row-queue">{{ formatQueueTypeLabel(rec) }}</span>
            </div>
            <div class="archive-row-hero">
              <span class="archive-row-hero-name">{{ formatHeroes(rec) }}</span>
              <span v-if="formatRoles(rec)" class="archive-row-role">{{ formatRoles(rec) }}</span>
            </div>
            <div class="archive-row-stats">
              <span class="archive-row-stat">{{ rec.data?.eliminations ?? '—' }}</span>
              <span class="archive-row-sep" aria-hidden="true">/</span>
              <span class="archive-row-stat">{{ rec.data?.assists ?? '—' }}</span>
              <span class="archive-row-sep" aria-hidden="true">/</span>
              <span class="archive-row-stat archive-row-stat-deaths">{{ rec.data?.deaths ?? '—' }}</span>
            </div>
            <div class="archive-row-actions">
              <template v-if="archiveConfirmKey !== rec.match_key">
                <button
                  type="button"
                  class="archive-unhide"
                  @click="emit('unhide-match', rec.match_key)"
                >
                  Unhide
                </button>
                <button
                  type="button"
                  class="archive-delete"
                  @click="confirmHardDelete(rec.match_key)"
                >
                  Delete forever
                </button>
              </template>
              <template v-else>
                <span class="archive-confirm-pre" aria-hidden="true">⚠</span>
                <button
                  type="button"
                  class="archive-confirm"
                  @click="commitHardDelete(rec.match_key)"
                >
                  Confirm
                </button>
                <button
                  type="button"
                  class="archive-cancel"
                  @click="cancelHardDelete"
                >
                  Cancel
                </button>
              </template>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- Right-click context menu on list rows. Teleports to body
         from inside the component so z-index conflicts with the
         narrow popover / detail panel don't sneak in. -->
    <MatchRowContextMenu
      :position="rowContextMenu ? { x: rowContextMenu.x, y: rowContextMenu.y } : null"
      :match-key="rowContextMenu?.matchKey ?? ''"
      :is-anchor="rowContextMenu !== null && rowContextMenu.matchKey === anchorKey"
      @close="onRowContextClose"
      @open-detail="onRowContextOpenDetail"
      @set-anchor="onRowContextSetAnchor"
      @hide="onRowContextHide"
    />
    </div>

    <!-- Fixed-position back-to-top button. Only mounted while the
         Matches view is rendered (sits inside the workspace section)
         so it doesn't bleed onto other tabs. Visibility tracks the
         useScrollAffordance threshold — appears once the user is
         clearly inside the leaves list, vanishes when they're back
         near the dossier. -->
    <Transition name="scroll-top-fade">
      <button
        v-if="isPastScrollThreshold"
        type="button"
        class="scroll-to-top"
        data-scroll-to-top
        aria-label="Scroll to top of page"
        title="Scroll to top"
        @click="scrollToTop"
      >
        <span class="scroll-to-top-glyph" aria-hidden="true">↑</span>
      </button>
    </Transition>
  </section>
</template>

<style scoped>
.matches-set-workspace {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
}

/* Campaign Log sticky wrapper. The sentinel is a 1 px line that
   sits just above the timeline at its natural position; the
   wrapper itself is position: sticky so it pins as the user
   scrolls past. .campaign-log-pinned adds a hairline bottom
   border so the strip reads as chrome when separated from its
   normal context. z-index above the leaves list but below
   modals / popovers. */
.campaign-log-sentinel {
  height: 1px;
  width: 100%;
}

.campaign-log-sticky {
  position: sticky;
  top: 0;
  z-index: 4;
  background: var(--bg);
  transition: box-shadow var(--duration-fast) ease;
}

.campaign-log-pinned {
  box-shadow: 0 1px 0 0 var(--border-soft, var(--border));
}

@media (prefers-reduced-motion: reduce) {
  .campaign-log-sticky {
    transition: none;
  }
}

/* Rail mode — switch to a 2-column grid with the always-visible
   filter aside in column 1 and everything else in column 2.
   Activated when `narrowMode === 'rail'` (viewport >= 1400 px or
   user-forced via useNarrowMode override). */
.matches-set-workspace-rail {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: start;
  gap: 1.1rem;
}

.matches-content-column {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  min-width: 0;
}

/* ─── Dossier ──────────────────────────────────────────────── */

.set-dossier {
  background:
    repeating-linear-gradient(
      135deg,
      color-mix(in srgb, var(--accent) 3%, transparent) 0,
      color-mix(in srgb, var(--accent) 3%, transparent) 10px,
      transparent 10px,
      transparent 20px
    ),
    var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 1rem 1.2rem 0.9rem;
  display: flex;
  flex-direction: column;
  gap: 0.8rem;
  position: relative;
}

.set-dossier::before {
  content: '';
  position: absolute;
  left: 0; top: 0;
  width: 4px; height: 100%;
  background: var(--accent);
  border-radius: 2px 0 0 2px;
}

.dossier-head { display: flex; flex-direction: column; gap: 0.2rem; }

.dossier-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.dossier-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.7rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
  color: var(--text);
  line-height: 1.1;
}

.dossier-meta {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
}

/* Shape-agnostic widget row. Each row is a flex grid of
   `<DashboardWidget>` cells of mixed shapes; auto-fit + a wider
   min-width on `.breakdown` lets KPI tiles and breakdown articles
   coexist (breakdown cells claim more width to render their bar
   visualization legibly). Phase 3 will allow widgets to move
   between rows, so neither row is shape-specific.

   The tile/breakdown CHROME (border, padding, background) now lives
   in DashboardWidget.vue's scoped block. Everything else (`.kpi-*` /
   `.breakdown-*` / `.bd-*`) was promoted to app.css since 10 widget
   SFCs reference them. */
.dashboard-row {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 0.5rem;
  align-items: start;

  /* Defensive: keep any descendant `position: absolute` (e.g. a
     mid-transition leave-active widget, mid-drag ghost overlay) confined
     to the row's box instead of escaping up to .set-dossier and
     overlapping the header / sibling rows. */
  position: relative;
}

/* Breakdown widgets need more room than KPI tiles to render their
   bar visualization (map/hero labels + bar + share %). Span 2 grid
   tracks instead of setting `min-width: 280px` on the cell —
   `min-width` on a grid child forces the track to grow past the
   `minmax(180px, 1fr)` calculation, which collides with the
   auto-fit track count when the row also holds KPIs. The result
   was visual overlap on dense rows. Spanning 2 tracks keeps the
   breakdown wide enough for its bars while staying inside the
   grid's track budget — auto-fit clamps the span to the available
   track count at narrow widths, so a 320px viewport still renders
   cleanly. */
.dashboard-row :deep(.breakdown) {
  grid-column: span 2;
}

/* "+ Add widget" affordance sits in its own dedicated row, full
   width, beneath every widget row. Reserves a clear, prominent
   slot so users find the add path without hunting through a busy
   last widget row — and ensures the AddTile's pulse animation
   never crowds an adjacent widget's trash button or drag grip. */
.dashboard-add-row {
  display: flex;
  margin-top: 0.5rem;
}

.dashboard-add-row :deep(.dashboard-add-tile) {
  flex: 1 1 auto;
  width: 100%;
  min-height: 3.2rem;
}

.dossier-actions { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.2rem; }

/* Edit-dashboard pill switch. Two equal-width segments (VIEW | EDIT)
   with a sliding thumb that crosses on toggle. The native checkbox
   is visually hidden (sr-only) but keeps full focus + keyboard
   reachability. Active segment's label sits ABOVE the thumb via
   z-index so the text reads in inverse contrast.

   Vocabulary: monospace caps, the OW orange accent, 2px square
   corners — keeps it sibling-consistent with .dossier-btn but reads
   as a STATE control rather than an action button. */
.dossier-edit-switch {
  display: inline-flex;
  align-items: center;
  position: relative;
  isolation: isolate;
  cursor: pointer;
  user-select: none;
}

/* Visually invisible but pointer-clickable overlay so the native
   <input type="checkbox"> handles all the platform's checkbox
   semantics (label clicks, ARIA pressed state, Space/Enter
   keyboard activation) without the user ever seeing a default
   checkbox. Sized to fully cover the styled track underneath so
   any pixel-perfect click lands on the input first. The styled
   track + segments + thumb get `pointer-events: none` so they're
   purely decorative — every click + hover hits the input. */
.dossier-edit-switch-input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  opacity: 0;
  cursor: pointer;
  z-index: 2;
}

.dossier-edit-switch-track {
  position: relative;
  display: grid;
  grid-template-columns: 1fr 1fr;
  padding: 2px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface-2);
  pointer-events: none;
  transition: border-color 140ms ease, background 140ms ease;
}

.dossier-edit-switch-segment {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 3.6rem;
  padding: 0.32rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
  transition: color 160ms ease;
}

.dossier-edit-switch.is-on .dossier-edit-switch-segment[data-state="view"],
.dossier-edit-switch:not(.is-on) .dossier-edit-switch-segment[data-state="edit"] {
  color: var(--text-faint);
}

.dossier-edit-switch:not(.is-on) .dossier-edit-switch-segment[data-state="view"] {
  color: var(--text);
}

.dossier-edit-switch.is-on .dossier-edit-switch-segment[data-state="edit"] {
  color: var(--surface);
}

.dossier-edit-switch-thumb {
  position: absolute;
  top: 2px; bottom: 2px; left: 2px;
  width: calc(50% - 2px);
  border-radius: 999px;
  background: var(--text);
  box-shadow: 0 1px 3px rgb(0 0 0 / 18%);
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1),
              background 200ms ease;
  z-index: 0;
}

.dossier-edit-switch.is-on .dossier-edit-switch-thumb {
  transform: translateX(100%);
  background: var(--accent);
}

.dossier-edit-switch.is-on .dossier-edit-switch-track {
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
}

.dossier-edit-switch:hover .dossier-edit-switch-track {
  border-color: var(--accent);
}

.dossier-edit-switch:focus-within .dossier-edit-switch-track {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

@media (prefers-reduced-motion: reduce) {
  .dossier-edit-switch-thumb,
  .dossier-edit-switch-segment,
  .dossier-edit-switch-track {
    transition: none;
  }
}

/* ── Edit-mode workspace ─────────────────────────────────────
   Subtle radial dot pattern fades in when the dossier enters
   edit mode. Signals "this is a workspace" without making every
   widget border noisy. Pattern lives on a ::before so the
   underlying .set-dossier background stays untouched. */
.set-dossier-editing {
  position: relative;
}

.set-dossier-editing::before {
  content: '';
  position: absolute;
  inset: 0;
  pointer-events: none;
  background-image: radial-gradient(
    circle,
    color-mix(in srgb, var(--accent) 22%, transparent) 1px,
    transparent 1.6px
  );
  background-size: 14px 14px;
  background-position: 0 0;
  opacity: 0.55;
  z-index: 0;
  transition: opacity 260ms ease;
}

/* Stack direct children above the workspace dot-grid (::before
   sits at z-index 0). Scoped to .set-dossier-editing so the rule
   only fires when the workspace pattern is rendered — outside
   edit mode there's no dot-grid and no need to bump child
   stacking. Avoids creating stacking contexts that surprise the
   teleported customizer modal + undo toast. */
.set-dossier-editing > * { position: relative; z-index: 1; }

@media (prefers-reduced-motion: reduce) {
  .set-dossier-editing::before { transition: none; }
}

/* ── Widget enter / exit animation ──────────────────────────
   Wraps every .dashboard-row in <TransitionGroup>; new widgets
   scale-in from 0.94 with a fade, removed widgets scale-out
   while shrinking their box. The v-move transition handles
   same-row sibling shifts during drags + reorders.

   We deliberately do NOT use `position: absolute` on
   leave-active. That technique made siblings reflow instantly
   into the gap but escaped the leaving widget from its grid
   track — without a positioned ancestor it floated up to
   .set-dossier and overlapped the dossier header. The "shrink
   in place" alternative keeps the cell width during the 240 ms
   leave, which reads as a deliberate fade-out rather than a
   broken layout. */
.dashboard-widget-enter-active,
.dashboard-widget-leave-active,
.dashboard-widget-move {
  transition: opacity 220ms ease,
              transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1),
              max-width 220ms cubic-bezier(0.2, 0.7, 0.3, 1),
              margin 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.dashboard-widget-leave-active {
  pointer-events: none;
}

.dashboard-widget-enter-from,
.dashboard-widget-leave-to {
  opacity: 0;
  transform: scale(0.94);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-widget-enter-active,
  .dashboard-widget-leave-active,
  .dashboard-widget-move { transition: none; }
}

.dossier-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.45rem 0.9rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}

.dossier-btn.primary {
  background: color-mix(in srgb, var(--accent) 14%, transparent);
  border-color: var(--accent);
  color: var(--accent);
}

.dossier-btn.primary.is-open {
  background: var(--accent);
  color: var(--surface);
}

.dossier-btn:hover { border-color: var(--accent); color: var(--accent); }
.dossier-btn.primary.is-open:hover { color: var(--surface); }

.narrow-count { color: inherit; font-weight: 700; }

/* ─── Active-clause chips ──────────────────────────────────── */

.active-chips {
  list-style: none;
  margin: 0.4rem 0 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.3rem;
}

.active-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.18rem 0.18rem 0.5rem;
  background: var(--surface-2);
  border: 1px solid var(--accent-soft, var(--accent));
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text);
}

.active-chip.range, .active-chip.search { border-color: var(--accent); }

.chip-key {
  color: var(--text-faint);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-size: 0.55rem;
}

.chip-val {
  color: var(--text);
  font-weight: 600;
  text-transform: lowercase;
}

.chip-x {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  padding: 0 0.3rem;
  font-size: 0.85rem;
  cursor: pointer;
  line-height: 1;
}
.chip-x:hover { color: var(--accent); }

.active-chip.clear {
  border: 1px dashed var(--text-faint);
  padding: 0;
}

.chip-clear {
  appearance: none;
  background: transparent;
  border: 0;
  padding: 0.18rem 0.55rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  font-weight: 700;
}
.chip-clear:hover { color: var(--accent); }

/* ─── Narrow popover ───────────────────────────────────────── */

.narrow-anchor { position: relative; }


/* ─── Leaves head: sort + group ────────────────────────────── */

.leaves {
  border: 1px solid var(--border);
  background: var(--surface);
  border-radius: 2px;
  padding: 0.7rem 1rem 0.85rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.leaves-head {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 0.85rem;
  flex-wrap: wrap;
}
.leaves-head-left { display: flex; flex-direction: column; gap: 0.1rem; }

.leaves-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;

  /* --accent-text is the theme-aware "accent for text" token: bright
     orange on dark themes (same as --accent), deep rust on day for
     AA contrast on cream. Using --accent directly here failed AA in
     day theme (1.92:1 on cream). */
  color: var(--accent-text);
  font-weight: 700;
}

.leaves-title {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  margin: 0;
}

/* ─── Leaves-head controls row ───────────────────────────────────
   Three peer affordances — Sort + Group trigger, Density segmented
   control, Jump-to-undated. Each used to ship with its own
   typographic register and height; they now all live on a shared
   ~28 px button shape so the row reads as one family. The shared
   baseline is reproduced under each control's selector rather than
   extracted into a class because Vue's <style scoped> doesn't let
   us @extend, and the rules are short enough that DRY-by-mixin
   isn't worth the indirection. */

.leaves-head-controls {
  display: inline-flex;
  gap: 0.5rem;
  align-items: center;
}

/* Combined Sort + Group trigger — single button replaces the prior
   two segmented fieldsets so the head controls fit comfortably
   alongside the Density picker without overflowing the row. */
.sort-group-trigger {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  padding: 0.4rem 0.8rem;
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.sort-group-trigger:hover {
  color: var(--text);
  border-color: var(--text-faint);
  background: rgb(255 255 255 / 2.5%);
}

.sort-group-trigger.open,
.sort-group-trigger:focus-visible {
  color: var(--text);
  border-color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  outline: none;
}

.sort-group-label {
  display: inline-block;
}

.sort-group-caret {
  font-size: 0.85rem;
  line-height: 1;
  transform: translateY(-1px);
  transition: transform var(--duration-fast) ease;
}

.sort-group-trigger.open .sort-group-caret {
  transform: translateY(-1px) rotate(180deg);
}

/* Density segmented control (`.seg` + `.seg-btn` × 2). Same overall
   button-row shape as the sort trigger, but two halves joined by a
   shared 1 px divider so they read as a single connected control.
   Only used in this row — safe to keep scoped here rather than
   promoting to app.css. */
.seg {
  appearance: none;
  display: inline-flex;
  align-items: stretch;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  background: transparent;
  margin: 0;
  padding: 0;
  overflow: hidden;
}

.seg-legend {
  position: absolute;
  width: 1px; height: 1px;
  margin: -1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.seg-btn {
  appearance: none;
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0.4rem 0.8rem;
  font-family: var(--body);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
  transition: color var(--duration-fast) ease,
              background var(--duration-fast) ease;
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--border-strong);
}

.seg-btn:hover {
  color: var(--text);
  background: rgb(255 255 255 / 2.5%);
}

.seg-btn:focus-visible {
  color: var(--text);
  outline: none;
  background: color-mix(in srgb, var(--accent) 8%, transparent);
}

.seg-btn.picked {
  background: var(--accent);

  /* Documented text-on-accent token so the picked label clears AA
     against the orange fill on every theme — day's accent is the
     same OW orange as dark/night, but day's --surface is a light
     cream that would push white-on-orange to ~1.92:1 (sub-AA). */
  color: var(--primary-text-on-accent);
}

.seg-btn.picked:hover,
.seg-btn.picked:focus-visible {
  /* Keep the orange fill — don't let the shared hover stack lift it
     to a translucent tint, which would visually un-pick the label. */
  background: var(--accent);
  color: var(--primary-text-on-accent);
}

/* ─── Section dividers + leaf rows ─────────────────────────── */

.leaves-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.section-divider {
  display: grid;
  grid-template-columns: auto auto 1fr;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0 0.15rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}
.section-divider:first-child { padding-top: 0.1rem; }

.sd-line {
  height: 1px;
  background: linear-gradient(90deg, var(--border) 0%, var(--border) 70%, transparent);
}
.sd-label { color: var(--accent); }

.sd-count {
  font-family: var(--mono);
  font-size: 0.56rem;
  letter-spacing: 0.1em;
  color: var(--text-faint);
  padding: 0.05rem 0.35rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

/* Seven-cell grid with fixed children per row — every leaf-row
   produces exactly seven DOM children so the grid never overflows
   into implicit columns (the cause of the "17 next to victory" bug
   where tag/leaver spans pushed the stats + result chip into
   adjacent cells). Sub-containers stack their own content
   internally with flex. */
.leaf-row {
  display: grid;

  /* Eight columns: contextual checkbox at the head, then the original
     seven. The checkbox column is fixed-width so its appearance never
     shifts the rest of the row when its opacity ramps up. */
  grid-template-columns:
    1.1rem               /* checkbox — always reserved, opacity-driven */
    4px                  /* strip */
    72px                 /* when */
    minmax(0, 1.4fr)     /* map block */
    minmax(0, 1fr)       /* hero block */
    7rem                 /* stats — fixed so hero left edge aligns */
    minmax(0, 1fr)       /* meta */
    6rem;                /* result chip — match the chip's own width */

  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: var(--surface);
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
}

.leaf-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  border-color: var(--accent-soft);
}

.leaf-strip {
  width: 4px; height: 36px;
  background: var(--text-faint);
  border-radius: 2px;
}
.leaf-row.result-victory .leaf-strip { background: var(--win); }
.leaf-row.result-defeat  .leaf-strip { background: var(--loss); }
.leaf-row.result-draw    .leaf-strip { background: var(--draw, var(--text-mute)); }

/* Compact density — tightens vertical rhythm so more rows fit on
   screen without going full data-table mode. Only the spacing and
   strip height change; grid template, fonts, and result-chip
   geometry stay so the eye reads rows the same way. */
.leaves-list.density-compact .leaf-row {
  padding: 0.3rem 0.85rem;
  gap: 0.65rem;
}
.leaves-list.density-compact .leaf-strip { height: 26px; }

/* Anchor row treatment — a left-edge accent stripe + a faint accent
   wash so users scanning the list can find their "since" match at a
   glance. The diamond glyph sits absolute in the row's top-right
   corner where it never collides with stats / result chips. */
.leaf-row.is-anchor {
  position: relative;
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: inset 3px 0 0 0 var(--accent);
}

.leaf-row.is-anchor:hover {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
}

.leaf-anchor-pin {
  position: absolute;
  top: 0.35rem;
  right: 0.5rem;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
  pointer-events: auto;
  cursor: help;
}

/* 2. When — date stacked over time. */
.leaf-when {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  line-height: 1;
}

.leaf-when-date {
  color: var(--text);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.leaf-when-time {
  color: var(--text-faint);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
}

/* 3. Where — map title + mode chip. */
.leaf-map-block {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.leaf-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}

/* Unknown-hero / Unknown-map warning variant. Same shape as the
   canonical leaf-hero / leaf-map but coloured with the accent —
   draws the eye to "this matched nothing in the YAML; an update
   is needed". The :title attribute carries the OCR'd text + the
   "wait for the next release" copy so a hover gives the full
   context without crowding the leaf row. */
.leaf-hero-unknown,
.leaf-map-unknown {
  color: var(--accent-bright, var(--accent));
  cursor: help;
}

.leaf-mode-row {
  display: inline-flex;
  gap: 0.25rem;
}

.leaf-mode-chip,
.leaf-queue-chip {
  font-family: var(--mono);
  font-size: 0.52rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  line-height: 1;
}

/* 4. Who — hero name + role label. */
.leaf-hero-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.leaf-hero {
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text);
  font-weight: 700;
  text-transform: lowercase;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}

.leaf-role {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 600;
}

/* 5. How — E/A/D, big bold tabular numerals with thin separators. */
.leaf-stats-block {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  white-space: nowrap;
  padding: 0 0.3rem;
}

.stat-num {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  min-width: 1.1ch;
  text-align: center;
}
.stat-num.stat-deaths { color: var(--text-dim); }

.stat-sep {
  color: var(--text-faint);
  font-size: 0.85rem;
  padding: 0 0.25rem;
  font-weight: 400;
}

/* 6. Annotations — tags + leaver. Always renders (may be empty). */
.leaf-meta-block {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
  min-width: 0;
}

.leaf-tag {
  font-family: var(--mono);
  font-size: 0.58rem;
  padding: 0.12rem 0.36rem;
  border: 1px solid var(--accent-soft);
  border-radius: 2px;
  color: var(--accent);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  white-space: nowrap;
}

.leaf-leaver {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 800;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--loss);
  color: var(--loss);
  background: color-mix(in srgb, var(--loss) 12%, transparent);
  border-radius: 2px;
  letter-spacing: 0.14em;
}

.leaf-result-chip {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.32rem 0.85rem;
  border-radius: 2px;
  font-weight: 800;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-faint);

  /* Fixed width — VICTORY (7 chars + letter-spacing) was outgrowing
     the 5rem min-width and pushing the chip wider than DEFEAT / DRAW
     so the result column lost its vertical alignment across rows.
     6rem fits the longest label comfortably and the rest center inside
     it. (Global box-sizing: border-box means width includes padding +
     border.) */
  width: 6rem;
  text-align: center;
  line-height: 1;
}

.leaf-result-chip.result-victory {
  background: color-mix(in srgb, var(--win) 22%, var(--surface));
  border-color: var(--win-line, var(--win));
  color: var(--win);
}

.leaf-result-chip.result-defeat {
  background: color-mix(in srgb, var(--loss) 22%, var(--surface));
  border-color: var(--loss-line, var(--loss));
  color: var(--loss);
}

.leaf-result-chip.result-draw {
  background: color-mix(in srgb, var(--text-mute) 18%, var(--surface));
  border-color: var(--text-mute);
  color: var(--text);
}

.leaves-empty {
  margin: 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-dim);
  padding: 1.5rem 0;
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  align-items: center;
}

/* Infinite-scroll sentinel — zero-height marker observed by the
   IntersectionObserver. Doesn't render anything visible; the
   visual "you've reached more rows" affordance is the foot
   below it. */
.leaves-sentinel {
  height: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* "Showing N of M" foot. Visually subdued — same tone as the
   empty-state copy — so it sits below the rows without
   competing with the result chips above. */
.leaves-foot {
  margin: 0;
  padding: 0.9rem 0 1.1rem;
  text-align: center;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
  list-style: none;
}

.leaves-empty-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--accent);
  border-radius: 2px;
  padding: 0.35rem 0.85rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
  cursor: pointer;
  font-weight: 700;
}
.leaves-empty-btn:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }

/* ─── Contextual multi-select ──────────────────────────────────
   No mode toggle. A faint checkbox always sits at the start of each
   row; it brightens on row hover, when the row is ticked, or when
   ANY row in the section is ticked. The Gmail / Linear pattern. */

.leaf-checkbox,
.archive-checkbox {
  width: 1.1rem;
  height: 1.1rem;
  border: 1.5px solid var(--border);
  border-radius: 2px;
  background: var(--surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  appearance: none;
  opacity: 0.32;
  transition:
    background-color 80ms ease,
    border-color 80ms ease,
    opacity 120ms ease;
}

.leaf-row:hover .leaf-checkbox,
.leaf-row.has-selection .leaf-checkbox,
.leaf-row.is-ticked .leaf-checkbox,
.leaf-checkbox:focus-visible,
.archive-row:hover .archive-checkbox,
.archive-row.has-selection .archive-checkbox,
.archive-row.is-ticked .archive-checkbox,
.archive-checkbox:focus-visible {
  opacity: 1;
}

.leaf-row.is-ticked .leaf-checkbox,
.archive-row.is-ticked .archive-checkbox {
  background: var(--accent);
  border-color: var(--accent);
}

.leaf-row.is-ticked {
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  outline: 1px solid var(--accent);
}

.archive-row.is-ticked {
  background: color-mix(in srgb, var(--accent) 12%, var(--surface-2));
  outline: 1px solid var(--accent);
  opacity: 1;
}

.leaf-checkbox-glyph,
.archive-checkbox-glyph {
  font-family: var(--mono);
  font-weight: 800;
  font-size: 0.75rem;
  color: var(--primary-text-on-accent, #111);
  line-height: 1;
}

/* .bulk-action-bar styling moved into BulkActionBar.vue's scoped
   block (it owns its own markup now). The .archive-action-bar
   keeps the same base shape because it's the in-place Hidden
   drawer's sibling bar — separate use case, separate CSS. */
.archive-action-bar {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.65rem;
  border: 1px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface-2));
  border-radius: 2px;
  position: sticky;
  top: 0.4rem;
  z-index: 4;
  box-shadow: 0 1px 0 color-mix(in srgb, var(--accent) 30%, transparent);
  margin: 0 0 0.45rem;
}

.bab-glyph { color: var(--accent); font-size: 0.95rem; line-height: 1; }

.bab-count {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text);
}

.bab-spacer { flex: 1 1 auto; }

.bab-warn { color: var(--loss); font-size: 0.95rem; line-height: 1; }

.bab-warn-text {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 700;
}

.archive-action-bar button {
  appearance: none;
  border-radius: 2px;
  padding: 0.32rem 0.7rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  line-height: 1;
}

.bulk-unhide {
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--primary-text-on-accent, #111);
}

.bulk-unhide:hover { filter: brightness(1.08); }

.bulk-delete {
  border: 1px solid color-mix(in srgb, var(--loss) 70%, var(--border));
  background: transparent;
  color: var(--loss);
}

.bulk-delete:hover { background: color-mix(in srgb, var(--loss) 12%, transparent); }

.bulk-confirm {
  border: 1px solid var(--loss);
  background: var(--loss);
  color: var(--primary-text-on-accent, #111);
}

.bulk-confirm:hover { filter: brightness(1.06); }

.bulk-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}

.bulk-cancel:hover {
  color: var(--text);
  border-color: var(--text);
}

.bab-btn-glyph { font-size: 0.85rem; }

/* ─── Hidden drawer (Archive) ──────────────────────────────── */

.archive {
  margin-top: 0.4rem;
  border: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  background:
    repeating-linear-gradient(
      45deg,
      color-mix(in srgb, var(--text-dim) 3%, transparent) 0,
      color-mix(in srgb, var(--text-dim) 3%, transparent) 8px,
      transparent 8px,
      transparent 16px
    ),
    var(--surface);
  border-radius: 2px;
  overflow: hidden;
}

.archive-toggle {
  width: 100%;
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
  padding: 0.6rem 0.85rem;
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  text-align: left;
}
.archive-toggle:hover { background: color-mix(in srgb, var(--text-dim) 5%, transparent); }

.archive-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}
.archive-title { display: inline-flex; align-items: baseline; gap: 0.5rem; }

.archive-count {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.15rem;
  color: var(--text);
  line-height: 1;
}

.archive-noun {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
}

.archive-chev {
  margin-left: auto;
  color: var(--text-dim);
  font-size: 0.9rem;
  transform: rotate(-90deg);
  transition: transform 120ms ease;
}
.archive-chev.open { transform: rotate(0deg); }

.archive-panel {
  border-top: 1px dashed color-mix(in srgb, var(--border) 80%, transparent);
  padding: 0.55rem 0.7rem 0.7rem;
}

.archive-empty {
  margin: 0;
  text-align: center;
  font-family: var(--mono);
  color: var(--text-dim);
  font-size: 0.7rem;
  padding: 0.7rem 0;
}

.archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.archive-row {
  display: grid;
  grid-template-columns:
    1.1rem        /* checkbox — reserved, opacity-driven */
    6px           /* result strip */
    minmax(64px, auto) /* date/time */
    minmax(140px, 1fr) /* map */
    minmax(140px, 1fr) /* hero */
    minmax(110px, auto) /* stats */
    auto;         /* actions */

  align-items: center;
  gap: 0.55rem;
  padding: 0.4rem 0.6rem;
  border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
  border-radius: 2px;
  background: color-mix(in srgb, var(--surface-2) 70%, transparent);

  /* dimmed treatment — archived feel without losing legibility */
  opacity: 0.78;
}
.archive-row:hover { opacity: 0.96; }

.archive-row-strip {
  width: 4px;
  height: 1.6rem;
  background: var(--text-faint);
  border-radius: 1px;
}
.archive-row.result-victory .archive-row-strip { background: var(--win); }
.archive-row.result-defeat  .archive-row-strip { background: var(--loss); }
.archive-row.result-draw    .archive-row-strip { background: var(--accent); }

.archive-row-when {
  display: flex;
  flex-direction: column;
  gap: 0.05rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-dim);
}
.archive-row-date { color: var(--text); font-weight: 700; letter-spacing: 0.04em; }
.archive-row-time { color: var(--text-faint); }
.archive-row-map { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }

.archive-row-map-name {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 0.95rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-row-mode,
.archive-row-queue {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.archive-row-queue { margin-left: 0.4rem; }
.archive-row-hero { display: flex; flex-direction: column; gap: 0.05rem; min-width: 0; }

.archive-row-hero-name {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.92rem;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.archive-row-role {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.archive-row-stats {
  display: inline-flex;
  align-items: baseline;
  gap: 0.2rem;
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  color: var(--text);
}
.archive-row-stat { font-size: 0.95rem; letter-spacing: 0.02em; }
.archive-row-stat-deaths { color: var(--text-dim); }
.archive-row-sep { color: var(--text-faint); font-size: 0.8rem; }

.archive-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  white-space: nowrap;
}

.archive-row-actions button {
  appearance: none;
  border-radius: 2px;
  padding: 0.3rem 0.6rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  cursor: pointer;
  line-height: 1;
}

.archive-unhide {
  border: 1px solid var(--accent);
  background: transparent;
  color: var(--accent);
}
.archive-unhide:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }

.archive-delete {
  border: 1px solid color-mix(in srgb, var(--loss) 70%, var(--border));
  background: transparent;
  color: var(--loss);
}
.archive-delete:hover { background: color-mix(in srgb, var(--loss) 12%, transparent); }

.archive-confirm-pre {
  color: var(--loss);
  font-size: 0.95rem;
  line-height: 1;
  padding-right: 0.1rem;
}

.archive-confirm {
  border: 1px solid var(--loss);
  background: var(--loss);
  color: var(--primary-text-on-accent, #111);
}
.archive-confirm:hover { filter: brightness(1.06); }

.archive-cancel {
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text-dim);
}
.archive-cancel:hover { color: var(--text); border-color: var(--text); }

/* ─── Scroll-to-top button ───────────────────────────────────────
   Fixed at the lower-left of the viewport, fades in once the user is
   past ~400 px down (useScrollAffordance). Circular, 44x44 so the
   target meets the a11y minimum. z-index 5 keeps it above the sticky
   Campaign Log (z-index 4) but below modals (1090+). */

.scroll-to-top {
  position: fixed;
  left: 1.5rem;
  bottom: 1.5rem;
  z-index: 5;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  appearance: none;
  background: var(--surface-2);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 50%;
  font-family: var(--mono);
  font-size: 1.15rem;
  line-height: 1;
  cursor: pointer;
  box-shadow: 0 6px 20px rgb(0 0 0 / 35%);
  transition: background var(--duration-fast) ease,
              border-color var(--duration-fast) ease,
              color var(--duration-fast) ease,
              transform var(--duration-fast) ease;
}

.scroll-to-top:hover,
.scroll-to-top:focus-visible {
  background: var(--surface);
  border-color: var(--accent);
  color: var(--accent);
  outline: none;
  transform: translateY(-1px);
}

.scroll-to-top-glyph {
  display: block;
  font-weight: 700;
}

.scroll-top-fade-enter-active,
.scroll-top-fade-leave-active {
  transition: opacity var(--duration-med) ease,
              transform var(--duration-med) ease;
}

.scroll-top-fade-enter-from,
.scroll-top-fade-leave-to {
  opacity: 0;
  transform: translateY(8px);
}

/* ─── Jump-to-undated button ─────────────────────────────────────
   Sits as a third sibling next to the density fieldset in the
   leaves-head-controls row. Same .btn ghost foundation other ghost
   actions use; the jump-glyph keeps the affordance visually distinct
   from the density toggle without leaving the row's flow. */

/* Jump-to-undated lives on the .btn ghost shape (defined in app.css)
   so it shares height + typography + hover with .sort-group-trigger
   and .seg-btn above. The local rules only add the
   inline-flex / gap shape needed for the "↓ N undated" label and the
   soft-emphasis state via .has-undated. */
.jump-to-undated {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;

  /* Match the sort/density padding so the three controls share an
     exact button-row height. The .btn ghost padding (0.55 × 0.95)
     would push this control a few px taller than its peers. */
  padding: 0.4rem 0.8rem;
}

.jump-to-undated[disabled] {
  cursor: not-allowed;
  opacity: 0.55;
}

.jump-glyph {
  font-family: var(--mono);
  font-weight: 700;
  color: var(--accent);
  font-size: 0.85rem;
  line-height: 1;
  transform: translateY(-1px);
}

.jump-to-undated[disabled] .jump-glyph {
  color: var(--text-faint);
}

/* Soft emphasis — applied when undatedCount > 0. Hints at "there's
   something to triage" without shouting; the accent tint is subtle
   enough to live alongside the unpicked density button without
   competing for attention. */
.jump-to-undated.has-undated {
  background: var(--accent-soft);
  border-color: color-mix(in srgb, var(--accent) 35%, var(--border-strong));
  color: var(--text);
}

.jump-to-undated.has-undated:hover,
.jump-to-undated.has-undated:focus-visible {
  background: color-mix(in srgb, var(--accent) 16%, var(--surface-2));
  border-color: var(--accent);
}

.jump-to-undated.has-undated .jump-glyph {
  color: var(--accent-bright, var(--accent));
}

@media (prefers-reduced-motion: reduce) {
  .scroll-to-top,
  .scroll-top-fade-enter-active,
  .scroll-top-fade-leave-active {
    transition: none;
  }

  .scroll-to-top:hover,
  .scroll-to-top:focus-visible {
    transform: none;
  }
}
</style>

<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref } from 'vue'
import type { MatchRecord } from '../api'
import { GetProfiles } from '../api'
import { useMatchesDossier } from '../composables/useMatchesDossier'
import { provideDossier } from '../composables/useDossier'
import { provideNarrow } from '../composables/useNarrow'
import MatchesSortGroupPopover from './MatchesSortGroupPopover.vue'
import { useWeekStart } from '../composables/useWeekStart'
import { useDensity } from '../composables/useDensity'
import { useScrollAffordance } from '../composables/useScrollAffordance'
import { useOWData } from '../composables/useOWData'
import type { useMatchesNarrow } from '../composables/useMatchesNarrow'
import { useArchiveSelection } from '../composables/useArchiveSelection'
import MatchesDossierHead from './MatchesDossierHead.vue'
import MatchesDossierSections from './MatchesDossierSections.vue'
import BulkActionBar from './BulkActionBar.vue'
import MatchesArchiveDrawer from './MatchesArchiveDrawer.vue'
import MatchesMembersList from './MatchesMembersList.vue'
// NarrowPopover is the heavyweight authoring surface (the search +
// combobox + range pickers + active-clause range etc.). Lazy-load
// it so MatchesView's initial chunk doesn't carry its ~30K of
// bytes. The popover only mounts (v-if inside the child) when the
// user clicks "Narrow this set", so the deferred fetch is invisible
// in practice. Regression covered by MatchesView.lazy-views.test.ts.
const NarrowPopover = defineAsyncComponent(() => import('./NarrowPopover.vue'))
import MatchRowContextMenu from './MatchRowContextMenu.vue'
import LeafHoverPreview from './LeafHoverPreview.vue'
import { useMatchesRowContext } from '../composables/useMatchesRowContext'
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
//   map, game mode, hero (broad-match against heroes_played[]),
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
  // Bulk-tag pipe — emitted with the ticked-key list + the chosen
  // tag. App.vue does the read-modify-write per record via
  // SetMatchAnnotation (preserving existing tags + appending the
  // new one) and reloads the matches feed.
  'bulk-tag':       [matchKeys: string[], tag: string]
  // Right-click menu fast-tracks — App.vue does the work since the
  // detail panel + clipboard + OS reveal all live up the tree.
  'open-match-and-focus': [matchKey: string, target: 'note' | 'tag']
  'copy-replay-code':     [matchKey: string]
  'copy-match-link':      [matchKey: string]
  'open-source-folder':   [matchKey: string]
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
  pickedRange, customFrom, customTo,
  leaverHandling,
  anchorKey,
  resetNarrow,
  anyNarrow,
  searchClauses,
  narrowedRecords,
  clauseExclusionCounts,
} = props.narrow

// ─── View-side state owned by MatchesView ───────────────────
// Narrow rail vs popover. At width >= 1400 px the filter panel
// renders as a peer column on the left of the workspace; below that
// it stays a modal popover triggered by the dossier-actions button.
// `useNarrowMode` also exposes a persisted user override so callers
// can force a mode (no UI surface in this PR).
const { mode: narrowMode } = useNarrowMode()
const sortOrder = ref<'newest' | 'oldest'>('newest')
const groupBy   = ref<'none' | 'day' | 'week' | 'month' | 'year'>('day')

// The members list owns the windowing; onJumpToUndated reaches into it
// to render the whole list before scrolling to the undated bucket.
const membersListRef = ref<InstanceType<typeof MatchesMembersList> | null>(null)

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
// Data density is a flat spreadsheet sorted by column header, so the
// trigger drops the grouping suffix there (grouping doesn't apply).
const sortGroupLabel = computed(() =>
  density.value === 'data'
    ? SORT_LABELS[sortOrder.value]
    : `${SORT_LABELS[sortOrder.value]} · ${GROUP_LABELS[groupBy.value]}`,
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
// MatchesArchiveDrawer consumes the rest of the api via the `archive`
// prop; MatchesView only needs the live subset + the two handlers its
// shared move / hard-delete wiring still drives.
const { archiveSelectedKeys, visibleRecords, clearArchiveSelection, cancelHardDelete } = archive

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

function onBulkTag(tag: string) {
  const keys = [...selectedKeys.value]
  if (keys.length === 0) return
  clearSelection()
  emit('bulk-tag', keys, tag)
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
  const keys = narrowedRecords.value.map((r) => r.match_key)
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
  membersListRef.value?.expandWindowToAll()
  await nextTick()
  // The "No date" group header carries data-section-key="no-date"
  // (added alongside this button); querying by attribute keeps the
  // jump robust to future class renames during visual refreshes.
  const target = document.querySelector('[data-section-key="no-date"]')
  if (!target) return
  const targetTop = target.getBoundingClientRect().top + window.scrollY
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
// Same provide/inject shape exposes the narrow handlers (pickHero,
// pickGameMode, etc.) to widgets that need to drill into a slice of
// the active set — the hero × game-mode heatmap is the first consumer.
provideNarrow(props.narrow)

// Row right-click menu + hover-preview state machine lives in the
// composable; the menu's *actions* stay here as the emit surface to
// App.vue ("Open detail", set-anchor, hide, copy replay/link, …).
const {
  rowContextMenu,
  onRowContext,
  onRowContextClose,
  replayCodeFor,
  hoverPreviewSrc,
  hoverPreviewX,
  hoverPreviewY,
  onLeafMouseEnter,
  onLeafMouseMove,
  onLeafMouseLeave,
} = useMatchesRowContext(narrowedRecords)

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

// New right-click actions added with item 7 — each forwards to App.vue
// for the heavy lifting (clipboard write, OS reveal, detail-panel
// focus-on-mount). Keeping the menu thin so feature evolution lives
// in one place at the top of the tree.
function onRowContextFocusTag(matchKey: string) {
  emit('open-match-and-focus', matchKey, 'tag')
}
function onRowContextFocusNote(matchKey: string) {
  emit('open-match-and-focus', matchKey, 'note')
}
function onRowContextCopyReplay(matchKey: string) {
  emit('copy-replay-code', matchKey)
}
function onRowContextCopyLink(matchKey: string) {
  emit('copy-match-link', matchKey)
}
function onRowContextOpenSourceFolder(matchKey: string) {
  emit('open-source-folder', matchKey)
}

// Wails-detect — duplicated as a one-liner so the menu doesn't have
// to import api.ts (keeps the leaf component's import surface narrow).
// `window.go` is set by the Wails runtime at boot; types come from
// frontend/wailsjs and are already in tsconfig's `include` so vue-tsc
// resolves the property without an @ts-expect-error.
const IS_WAILS = typeof window !== 'undefined' && !!window.go?.app?.App

onMounted(() => {
  // Fetch the profile list once for the Move-to picker. Failures
  // silently leave availableProfiles empty, which suppresses the
  // Move-to button — gracefully degrades to the original bulk action
  // bar instead of surfacing a broken affordance.
  GetProfiles().then((res) => { availableProfiles.value = res }).catch(() => undefined)
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
      <!-- ─── SET DOSSIER ─────────────────────────────────────────
         Summary + customizable widget grid + Add menu + popover-mode
         narrow trigger, all in MatchesDossierHead. Its widgets inject
         the shared dossier provided above. -->
      <MatchesDossierHead
        :narrow="props.narrow"
        :records="props.records"
        :narrow-mode="narrowMode"
        @open-match="(k: string) => emit('open-match', k)"
        @clear-anchor="emit('clear-anchor')"
        @narrow-open="(v: boolean) => emit('narrow-open', v)"
      />

      <!-- ─── DOSSIER SECTIONS (Campaign Log, Geography) ──────────
         Full-width bands below the dossier grid. `visibleRecords`
         strips hidden matches so the Campaign Log reconciles with the
         dossier; the brush on the Campaign Log drives the custom date
         range, which lands here as the picked range. -->
      <MatchesDossierSections
        :records="visibleRecords"
        :filter-from="customFrom"
        :filter-to="customTo"
        @update:filter-from="(v: string) => { customFrom = v; pickedRange = 'custom' }"
        @update:filter-to="(v: string) => { customTo = v; pickedRange = 'custom' }"
      />

      <!-- ─── MEMBERS ─────────────────────────────────────────── -->
      <section class="leaves" aria-label="Set members">
        <header class="leaves-head">
          <div class="leaves-head-left">
            <span class="leaves-eyebrow">Members</span>
            <h3 class="leaves-title">
              {{ narrowedRecords.length }} matches in this set
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
              <button
                class="seg-btn"
                :class="{ picked: density === 'data' }"
                :aria-pressed="density === 'data' ? 'true' : 'false'"
                :data-density-pick="density === 'data' ? 'data' : undefined"
                title="Table view — sortable columns, hairline rows"
                @click="setDensity('data')"
              >
                Data
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
              v-if="density !== 'data'"
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
          :sorted-count="narrowedRecords.length"
          :other-profiles="otherProfiles"
          :move-picker-open="movePickerOpen"
          :available-tags="narrow.availableTags.value"
          @select-all="selectAllVisible"
          @hide="hideSelected"
          @export-bundle="emit('export-bundle', [...selectedKeys])"
          @bulk-tag="onBulkTag"
          @move-begin="beginMoveLive"
          @move-commit="commitMove"
          @move-cancel="cancelMove"
          @clear="clearSelection"
          @bulk-play-mode="onBulkPlayMode"
          @bulk-queue="onBulkQueue"
        />

        <MatchesMembersList
          ref="membersListRef"
          :records="narrowedRecords"
          :group-by="groupBy"
          :sort-order="sortOrder"
          :density="density"
          :focused-card-index="props.focusedCardIndex"
          :selected-keys="selectedKeys"
          :anchor-key="anchorKey"
          :search-clauses="searchClauses"
          :any-narrow="anyNarrow"
          :clause-exclusion-counts="clauseExclusionCounts"
          @open-match="emit('open-match', $event)"
          @toggle-select="toggleSelected"
          @row-context="onRowContext"
          @hover-enter="onLeafMouseEnter"
          @hover-move="onLeafMouseMove"
          @hover-leave="onLeafMouseLeave"
          @reset-narrow="resetNarrow"
        />

        <!-- Combined Sort + Group dropdown — teleports to <body>, so it
           sits above the leaves list regardless of mount point. Driven
           by the trigger in the members header above. -->
        <MatchesSortGroupPopover
          :open="sortGroupOpen"
          :sort="sortOrder"
          :group="groupBy"
          :anchor="sortGroupAnchor"
          :grouping-disabled="density === 'data'"
          @close="closeSortGroup"
          @update:sort="(v) => { sortOrder = v }"
          @update:group="(v) => { groupBy = v }"
        />
      </section>

      <MatchesArchiveDrawer
        :archive="archive"
        :move-active="movePickerOpen === 'archive'"
        :other-profiles="otherProfiles"
        @unhide-match="(k: string) => emit('unhide-match', k)"
        @hard-delete-match="commitHardDelete"
        @begin-move="beginMoveArchive"
        @move-to-profile="commitMove"
        @cancel-move="cancelMove"
      />

      <!-- Right-click context menu on list rows. Teleports to body
         from inside the component so z-index conflicts with the
         narrow popover / detail panel don't sneak in. -->
      <LeafHoverPreview
        :src="hoverPreviewSrc"
        :x="hoverPreviewX"
        :y="hoverPreviewY"
      />
      <MatchRowContextMenu
        :position="rowContextMenu ? { x: rowContextMenu.x, y: rowContextMenu.y } : null"
        :match-key="rowContextMenu?.matchKey ?? ''"
        :is-anchor="rowContextMenu !== null && rowContextMenu.matchKey === anchorKey"
        :replay-code="rowContextMenu ? replayCodeFor(rowContextMenu.matchKey) : null"
        :is-wails="IS_WAILS"
        @close="onRowContextClose"
        @open-detail="onRowContextOpenDetail"
        @set-anchor="onRowContextSetAnchor"
        @open-detail-and-focus-tag="onRowContextFocusTag"
        @open-detail-and-focus-note="onRowContextFocusNote"
        @copy-replay-code="onRowContextCopyReplay"
        @copy-match-link="onRowContextCopyLink"
        @open-source-folder="onRowContextOpenSourceFolder"
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

  /* Single source of truth for the vertical rhythm between the
     dossier, the Campaign Log / Geography sections, and the members
     list. The bands used to carry their own margin-bottom, which left
     the dossier→first-section gap tighter than the gaps between bands;
     the gap now owns all of it uniformly. */
  gap: 1.2rem;
  min-width: 0;
}

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
   extracted into a class because Vue's \3c style scoped> doesn't let
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

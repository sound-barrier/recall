<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import type { MatchRecord } from '@/api'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import { provideDossier } from '@/composables/dashboard/useDossier'
import { provideNarrow } from '@/composables/matches/useNarrow'
import MatchesSortGroupPopover from '@/components/matches/list/MatchesSortGroupPopover.vue'
import MatchesTableSortPopover from '@/components/matches/list/MatchesTableSortPopover.vue'
import { useWeekStart } from '@/composables/shared/useWeekStart'
import { useDensity } from '@/composables/matches/useDensity'
import { useSortGroupMenu } from '@/composables/matches/useSortGroupMenu'
import { useScrollAffordance } from '@/composables/matches/useScrollAffordance'
import { useOWData } from '@/composables/shared/useOWData'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { useArchiveSelection } from '@/composables/matches/useArchiveSelection'
import MatchesDossierHead from '@/components/matches/dossier/MatchesDossierHead.vue'
import MatchesDossierSections from '@/components/matches/dossier/MatchesDossierSections.vue'
import BulkActionBar from '@/components/matches/list/BulkActionBar.vue'
import MatchesArchiveDrawer from '@/components/matches/list/MatchesArchiveDrawer.vue'
import MatchesMembersList from '@/components/matches/list/MatchesMembersList.vue'
import MatchesListToolbar from '@/components/matches/list/MatchesListToolbar.vue'
import { useMatchesSelection } from '@/composables/matches/useMatchesSelection'
import { useMatchesMovePicker } from '@/composables/matches/useMatchesMovePicker'
import { matchesToCSV } from '@/match/match-csv'
// NarrowPopover is the heavyweight authoring surface (the search +
// combobox + range pickers + active-clause range etc.). Lazy-load
// it so MatchesView's initial chunk doesn't carry its ~30K of
// bytes. The popover only mounts (v-if inside the child) when the
// user clicks "Narrow this set", so the deferred fetch is invisible
// in practice. Regression covered by MatchesView.lazy-views.test.ts.
const NarrowPopover = defineAsyncComponent(() => import('@/components/matches/narrow/NarrowPopover.vue'))
// Statically imported (it's tiny and renders collapsed): the heavy
// ECharts dependency stays lazy because the <TrendChart> *inside*
// TrendsSection is the defineAsyncComponent, loaded only on expand.
import TrendsSection from '@/components/matches/trends/TrendsSection.vue'
import MatchRowContextMenu from '@/components/matches/list/MatchRowContextMenu.vue'
import LeafHoverPreview from '@/components/matches/list/LeafHoverPreview.vue'
import { useMatchesRowContext } from '@/composables/matches/useMatchesRowContext'
import { useNarrowMode } from '@/composables/matches/useNarrowMode'

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
  // Open the manual-entry modal (forwarded from the toolbar's Add match
  // button). App.vue owns the modal + the create round-trip.
  'add-match': []
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
  'bulk-play-mode': [matchKeys: string[], playMode: import('@/api').PlayMode]
  'bulk-queue':     [matchKeys: string[], queueType: import('@/api').QueueType]
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
  // Flat CSV export — emitted with the ready-to-save CSV string + a
  // default filename. App.vue dispatches it to ExportMatchesCSV (Wails
  // save dialog or browser blob download); the string is assembled here
  // because the narrowed set + heroRole live in this view.
  'export-csv': [csv: string, defaultName: string]
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

// The members list owns the windowing; onJumpToUndated reaches into it
// to render the whole list before scrolling to the undated bucket.
const membersListRef = ref<InstanceType<typeof MatchesMembersList> | null>(null)

// Narrowing from a dossier affordance (a heatmap cell in the Hero ×
// Game-Mode band, a Campaign Log day, a Geography cell, …) makes the
// active-clause chips appear and the breakdown widgets re-flow in the
// dossier head ABOVE the sections — and the flat list's reset scrolls
// the document to the list top. Either way the content the user just
// clicked gets shoved out from under their cursor. WebKit (the Wails
// webview) has no scroll-anchoring to absorb it, so we anchor it
// explicitly: capture the members section's viewport position before the
// re-render and restore it after, but only when the user is scrolled
// ABOVE the list (so an in-list reset still scrolls to the top).
const leavesSectionRef = ref<HTMLElement | null>(null)
watch(narrowedRecords, () => {
  const el = leavesSectionRef.value
  if (!el) return
  const before = el.getBoundingClientRect().top
  if (before <= 0) return // user is scrolled into the list — leave it
  nextTick(() => {
    const after = el.getBoundingClientRect().top
    const delta = after - before
    if (Math.abs(delta) > 1) window.scrollBy(0, delta)
  })
}, { flush: 'pre' })


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
const {
  selectedKeys,
  toggleSelected,
  clearSelection,
  hideSelected,
  selectAllVisible,
  onBulkPlayMode,
  onBulkQueue,
  onBulkTag,
} = useMatchesSelection({
  narrowedRecords: () => narrowedRecords.value,
  onHide: (keys) => emit('hide-matches', keys),
  onBulkPlayMode: (keys, playMode) => emit('bulk-play-mode', keys, playMode),
  onBulkQueue: (keys, queueType) => emit('bulk-queue', keys, queueType),
  onBulkTag: (keys, tag) => emit('bulk-tag', keys, tag),
})

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

// ─── Move-to-profile picker (shared by the live bar + archive drawer) ───
const {
  movePickerOpen,
  otherProfiles,
  beginMoveLive,
  beginMoveArchive,
  cancelMove,
  commitMove,
} = useMatchesMovePicker({
  liveKeys: () => [...selectedKeys.value],
  archiveKeys: () => [...archiveSelectedKeys.value],
  clearLive: clearSelection,
  clearArchive: clearArchiveSelection,
  onMove: (keys, target) => emit('move-matches', keys, target),
})


// Single-row inline commit for hard-delete (per-archive-row Delete
// button → Confirm/Cancel two-step). `confirmHardDelete` and
// `cancelHardDelete` come from the composable; `commitHardDelete`
// is the one piece that still emits up to App.vue because it talks
// to the parent's DELETE handler directly.
function commitHardDelete(key: string) {
  cancelHardDelete()
  emit('hard-delete-match', key)
}


// ─── Dossier KPIs / breakdowns via useMatchesDossier ───────
//
// The dossier needs a hero→role resolver to drive the open-queue-
// aware Most-played-roles breakdown. useOWData is a session-level
// singleton — it lazy-fetches `/api/v1/system/reference-data` and
// reuses the same reactive store across every consumer.
const ow = useOWData()

// Build the flat CSV for the data view's "Export CSV" affordances and
// hand it up to App.vue to save. Exports the ticked subset when any rows
// are selected, otherwise the whole narrowed set; the CSV is assembled
// here because the narrowed records + heroRole resolver live in this view.
function requestCsvExport(keys: string[]) {
  const wanted = keys.length > 0 ? new Set(keys) : null
  const rows = wanted ? narrowedRecords.value.filter((r) => wanted.has(r.match_key)) : narrowedRecords.value
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  emit('export-csv', matchesToCSV(rows, ow.heroRole), `recall-matches-${stamp}.csv`)
}

// PR B: weekStart drives the day-of-week breakdown's rotation so the
// row matches the user's calendar preference.
const { weekStart } = useWeekStart()
// Row-density preference for the leaves list. Persisted via
// usePersistedRef so the user's choice survives reloads. Default is
// `comfortable` (the historical render).
const { density, setDensity } = useDensity()

// Combined Sort + Group control (order, grouping, trigger-anchored popover).
const {
  sortOrder,
  groupBy,
  sortGroupOpen,
  sortGroupAnchor,
  onSortGroupTriggerClick,
  closeSortGroup,
  sortGroupLabel,
} = useSortGroupMenu(() => density.value)

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
  hoverPreviewSource,
  hoverPreviewEditedFields,
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

      <!-- ─── TRENDS ──────────────────────────────────────────────
         In-app time-series line charts over the narrowed set.
         Collapsed by default so ECharts stays in its own
         lazily-loaded chunk. -->
      <TrendsSection />

      <!-- ─── MEMBERS ─────────────────────────────────────────── -->
      <section ref="leavesSectionRef" class="leaves" aria-label="Set members">
        <MatchesListToolbar
          :match-count="narrowedRecords.length"
          :sort-group-open="sortGroupOpen"
          :sort-group-label="sortGroupLabel"
          :density="density"
          :undated-count="undatedCount"
          @toggle-sort-group="onSortGroupTriggerClick"
          @set-density="setDensity"
          @jump-to-undated="onJumpToUndated"
          @add-match="emit('add-match')"
        />

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
          @export-csv="requestCsvExport([...selectedKeys])"
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
          @export-csv="requestCsvExport([...selectedKeys])"
        />

        <!-- Combined Sort + Group dropdown — teleports to <body>, so it
           sits above the leaves list regardless of mount point. Driven
           by the trigger in the members header above. -->
        <MatchesSortGroupPopover
          :open="density !== 'data' && sortGroupOpen"
          :sort="sortOrder"
          :group="groupBy"
          :anchor="sortGroupAnchor"
          @close="closeSortGroup"
          @update:sort="(v) => { sortOrder = v }"
          @update:group="(v) => { groupBy = v }"
        />

        <!-- Data density sorts by column header — the same members-head
           trigger opens the Excel-style Custom Sort dialog instead of the
           leaf-list sort/group popover. -->
        <MatchesTableSortPopover
          :open="density === 'data' && sortGroupOpen"
          :anchor="sortGroupAnchor"
          @close="closeSortGroup"
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
        :source="hoverPreviewSource"
        :edited-fields="hoverPreviewEditedFields"
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

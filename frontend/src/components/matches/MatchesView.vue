<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { provideMatchesContext } from '@/composables/matches/useMatchesContext'
import MatchesSortGroupPopover from '@/components/matches/list/MatchesSortGroupPopover.vue'
import MatchesTableSortPopover from '@/components/matches/table/MatchesTableSortPopover.vue'
import { useDensity } from '@/composables/matches/table/useDensity'
import { useSortGroupMenu } from '@/composables/matches/list/useSortGroupMenu'
import { useScrollAffordance } from '@/composables/matches/list/useScrollAffordance'
import { useOWData } from '@/composables/shared/useOWData'
import CoachInboxBanner from '@/components/coach/inbox/CoachInboxBanner.vue'
import ParseStalenessBanner from '@/components/ingest/ParseStalenessBanner.vue'
import MatchesDossierHead from '@/components/matches/dossier/MatchesDossierHead.vue'
import MatchesDossierSections from '@/components/matches/dossier/MatchesDossierSections.vue'
import BulkActionBar from '@/components/matches/bulk/BulkActionBar.vue'
import MatchesArchiveDrawer from '@/components/matches/bulk/MatchesArchiveDrawer.vue'
import MatchesMembersList from '@/components/matches/list/MatchesMembersList.vue'
import MatchesListToolbar from '@/components/matches/list/MatchesListToolbar.vue'
import { matchesToCSV } from '@/match/export/match-csv'
import { seasonWindowToLocalDates } from '@/match/match-season-helpers'
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
import { useMatchesBulkActions } from '@/composables/matches/list/useMatchesBulkActions'
import { useMatchesRowActions } from '@/composables/matches/list/useMatchesRowActions'
import { useNarrowMode } from '@/composables/matches/narrow/useNarrowMode'
import { useDatabaseStore } from '@/stores/database'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { IS_WAILS } from '@/platform'
import { useMatchActions } from '@/composables/matches/useMatchActions'

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

// MatchesView reads everything from the stores — zero props, zero emits. Records
// + the narrow bundle + the export/CSV dispatch come from the matches store;
// detail-panel selection + card focus + the anchor toast + the narrow-panel /
// manual-match open-flags from the UI store; per-match + bulk mutations from
// useMatchActions.
const matchesStore = useMatchesStore()
// The toolbar's Import… is the same whole-database merge Settings offers.
const databaseStore = useDatabaseStore()
const uiStore = useUiStore()
const { selection } = uiStore
const { focusedCardIndex } = uiStore.cardFocus
const {
  onHideMatches,
  // Aliased — useMatchesSelection returns same-named key-binding wrappers.
  onBulkPlayMode: applyBulkPlayMode,
  onBulkQueue: applyBulkQueue,
  onBulkTag: applyBulkTag,
  onUnhideMatches,
  onHardDeleteMatches,
  onMoveMatches,
  onHardDeleteMatch,
  onCopyReplayCode,
  onCopyMatchLink,
  onOpenSourceFolder,
  onSetMatchHidden,
} = useMatchActions()

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
// NarrowPopover child, which receives the same `matchesStore.matchesNarrow`
// bundle and destructures the picker callbacks itself.
const {
  pickedRange, customFrom, customTo, customFromTime, customToTime,
  pickedSeason,
  anchorKey,
  resetNarrow,
  anyNarrow,
  searchClauses,
  narrowedRecords,
  clauseExclusionCounts,
} = matchesStore.matchesNarrow

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
  void nextTick(() => {
    const after = el.getBoundingClientRect().top
    const delta = after - before
    if (Math.abs(delta) > 1) window.scrollBy(0, delta)
  })
}, { flush: 'pre' })

// ─── Ticked rows, and what the bulk bars do with them ───────
//
// Live selection, the archive drawer's parallel selection, and the
// move-to-profile picker they share are wired together in the composable —
// that wiring changes when the bulk bars grow an action, which is not when
// this view changes. Destructured to top-level names so the template reads
// unchanged.
const {
  selectedKeys, toggleSelected, clearSelection, hideSelected, selectAllVisible,
  onBulkPlayMode, onBulkQueue, onBulkTag,
  archive, visibleRecords,
  movePickerOpen, otherProfiles, beginMoveLive, beginMoveArchive, cancelMove, commitMove,
  commitHardDelete,
} = useMatchesBulkActions({
  narrowedRecords,
  allRecords: () => matchesStore.records,
  hideMatches: onHideMatches,
  unhideMatches: onUnhideMatches,
  hardDeleteMatches: onHardDeleteMatches,
  hardDeleteMatch: onHardDeleteMatch,
  moveMatches: onMoveMatches,
  applyPlayMode: applyBulkPlayMode,
  applyQueue: applyBulkQueue,
  applyTag: applyBulkTag,
})

// ─── Dossier KPIs / breakdowns via useMatchesDossier ───────
//
// The dossier needs a hero→role resolver to drive the open-queue-
// aware Most-played-roles breakdown. useOWData is a session-level
// singleton — it lazy-fetches `/api/v1/system/reference-data` and
// reuses the same reactive store across every consumer.
const ow = useOWData()

// The picked season's day span, for the Campaign Log's passive highlight. The
// heatmap is filter-independent (full corpus), so a season pick otherwise leaves
// it unchanged; lighting the season's days gives the pick a visible echo there.
// '' bounds when no season is picked or the window can't be resolved.
const seasonHighlight = computed<{ from: string; to: string }>(() => {
  const window = pickedSeason.value ? ow.seasonWindow(pickedSeason.value) : null
  return window ? seasonWindowToLocalDates(window) : { from: '', to: '' }
})

// Build the flat CSV for the data view's "Export CSV" affordances and
// hand it up to App.vue to save. Exports the ticked subset when any rows
// are selected, otherwise the whole narrowed set; the CSV is assembled
// here because the narrowed records + heroRole resolver live in this view.
function requestCsvExport(keys: string[]) {
  const wanted = keys.length > 0 ? new Set(keys) : null
  const rows = wanted ? narrowedRecords.value.filter((r) => wanted.has(r.match_key)) : narrowedRecords.value
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  void matchesStore.onExportMatchesCSV(matchesToCSV(rows, ow.heroRole), `recall-matches-${stamp}.csv`)
}

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
// Every dossier and narrow bundle the descendant widgets inject, provided in
// one call. Which bundle a widget reads is a real distinction (narrowed data,
// unfiltered structure, narrow-minus-self for the two bands that would
// otherwise collapse from their own selection) and it is documented where the
// provides live — but it is not a distinction this view makes.
provideMatchesContext(matchesStore)

// The leaf-row right-click menu — its state machine AND what each item does,
// both in useMatchesRowActions. The eight one-line forwarders that used to sit
// here named the menu's contract, so they live with the menu.
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
  // Named, not `...rest`: a rest element takes whatever the explicit names
  // left over, so a new key from the wrapped state machine would land in the
  // bundle instead of becoming a binding — silently, with no type or lint
  // error until a template referenced the bare name at runtime.
  rowAction,
} = useMatchesRowActions({
  records: narrowedRecords,
  hideMatches: onHideMatches,
  copyReplayCode: onCopyReplayCode,
  copyMatchLink: onCopyMatchLink,
  openSourceFolder: onOpenSourceFolder,
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
      :narrow="matchesStore.matchesNarrow"
      :records="matchesStore.records"
      @open-match="(k: string) => selection.open(k)"
      @clear-anchor="uiStore.onSetAnchor('')"
    />

    <div class="matches-content-column">
      <!-- Coach notes waiting on a decision. Server-derived, so it
           survives a reload and a "Decide later" until every note in
           the inbox has a verdict. -->
      <CoachInboxBanner />
      <ParseStalenessBanner />

      <!-- ─── SET DOSSIER ─────────────────────────────────────────
         Summary + customizable widget grid + Add menu + popover-mode
         narrow trigger, all in MatchesDossierHead. Its widgets inject
         the shared dossier provided above. -->
      <MatchesDossierHead
        :narrow="matchesStore.matchesNarrow"
        :records="matchesStore.records"
        :narrow-mode="narrowMode"
        @open-match="(k: string) => selection.open(k)"
        @clear-anchor="uiStore.onSetAnchor('')"
        @narrow-open="uiStore.setNarrowOpen"
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
        :season-from="seasonHighlight.from"
        :season-to="seasonHighlight.to"
        @update:filter-from="(v: string) => { customFrom = v; customFromTime = ''; pickedRange = 'custom' }"
        @update:filter-to="(v: string) => { customTo = v; customToTime = ''; pickedRange = 'custom' }"
        @open-match="(k: string) => selection.open(k)"
      />

      <!-- ─── TRENDS ──────────────────────────────────────────────
         In-app time-series line charts over the narrowed set.
         Collapsed by default so ECharts stays in its own
         lazily-loaded chunk. -->
      <TrendsSection @open-match="selection.open($event)" />

      <!-- ─── MEMBERS ─────────────────────────────────────────── -->
      <section ref="leavesSectionRef" class="leaves" aria-label="Set members">
        <MatchesListToolbar
          :match-count="narrowedRecords.length"
          :sort-group-open="sortGroupOpen"
          :sort-group-label="sortGroupLabel"
          :density="density"
          :undated-count="undatedCount"
          :grouped="groupBy !== 'none'"
          @toggle-sort-group="onSortGroupTriggerClick"
          @set-density="setDensity"
          @jump-to-undated="onJumpToUndated"
          @add-match="uiStore.openManualMatch('full')"
          @add-leaver-exit="uiStore.openManualMatch('leaver-exit')"
          @import-matches="databaseStore.importMatches"
          @expand-all="membersListRef?.expandAllSections()"
          @collapse-all="membersListRef?.collapseAllSections()"
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
          :available-tags="matchesStore.matchesNarrow.availableTags.value"
          @select-all="selectAllVisible"
          @hide="hideSelected"
          @export-bundle="matchesStore.onExportBundleRequest([...selectedKeys])"
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
          :focused-card-index="focusedCardIndex"
          :selected-keys="selectedKeys"
          :anchor-key="anchorKey"
          :search-clauses="searchClauses"
          :any-narrow="anyNarrow"
          :clause-exclusion-counts="clauseExclusionCounts"
          @open-match="selection.open($event)"
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
        @unhide-match="(k: string) => onSetMatchHidden(k, false)"
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
        @open-detail="rowAction.openDetail"
        @set-anchor="rowAction.setAnchor"
        @open-detail-and-focus-tag="rowAction.focusTag"
        @open-detail-and-focus-note="rowAction.focusNote"
        @copy-replay-code="rowAction.copyReplay"
        @copy-match-link="rowAction.copyLink"
        @open-source-folder="rowAction.openSourceFolder"
        @hide="rowAction.hide"
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

<style scoped src="./MatchesView.css"></style>

<script setup lang="ts">
import { computed } from 'vue'
import type { Ref, ComputedRef } from 'vue'
import type { MatchRecord } from '../api'
import type { useMatchFilters } from '../composables/useMatchFilters'
import type { useFilterPanel } from '../composables/useFilterPanel'
import type { useMatchGrouping } from '../composables/useMatchGrouping'
import type { DensityMode } from '../composables/useDensityMode'
import type { MatchAnnotationInput } from '../api'
import type { MatchGroup } from '../match-helpers'
import FilterRail from './FilterRail.vue'
import MatchGroupSection from './MatchGroupSection.vue'
import MatchesAggregateStats from './MatchesAggregateStats.vue'
import MatchesFilterPills from './MatchesFilterPills.vue'

// MatchesView is the tab-panel for the "Matches" view. Pulled out of
// App.vue so it can be unit-tested with @vue/test-utils against the
// same composables App uses — the only thing that changes in tests is
// how the composables are seeded with fixtures.
//
// The boundary keeps state ownership in App.vue (records, expand state,
// preview state) so two views that share a record list (Matches +
// Unknown Maps) don't fork their per-card UI state. View components
// receive what they need via props/accessor functions and bubble
// mutations via emits.
//
// Composable returns are passed as bundled props (one prop per
// composable) instead of un-bundled into ~30 individual props. Same
// shape MatchGroupSection uses internally — readable, typesafe,
// keeps the template terse.

type FiltersApi = ReturnType<typeof useMatchFilters>
type FilterPanelApi = ReturnType<typeof useFilterPanel>
type GroupingApi = ReturnType<typeof useMatchGrouping<MatchRecord>>

// Per-card UI state lives in App.vue (shared with the Unknown Maps
// view); CardStateApi packages the accessors + handlers so this view
// can stay state-free.
export interface CardStateApi {
  isExpanded:    (id: string) => boolean
  isSourcesOpen: (id: string) => boolean
  // Refs (not their unwrapped values) — they're nested inside an
  // object, so Vue's template auto-unwrap doesn't reach them at this
  // depth. Consumers access via `.value`.
  previewOpen:   Ref<Record<string, boolean>>
  previewError:  Ref<Record<string, boolean>>
  allExpanded:   Readonly<Ref<boolean> | ComputedRef<boolean>>
  toggleAll:     () => void
  toggleExpand:  (id: string) => void
  toggleSources: (id: string) => void
  togglePreview: (filename: string) => void
  onPreviewError: (filename: string) => void
}

const props = defineProps<{
  records: MatchRecord[]
  loading: boolean
  filters:     FiltersApi
  filterPanel: FilterPanelApi
  grouping:    GroupingApi
  cardState:   CardStateApi
  earliestMatchDateTime: string
  nowDateTime: string
  // "Include undated" toggle state. Owned by App.vue (via the
  // useIncludeUndated composable) so the preference persists across
  // navigation and launches.
  includeUndated: boolean
  // Min-play threshold state (also persisted by App.vue via the
  // useMinPlayThreshold composable). 0 means the input is empty /
  // disabled.
  minPlayPercent: number
  minPlayMinutes: number
  // Match-list density toggle (persisted via useDensityMode). 'compact'
  // tightens padding + map font and inlines E/A/D + damage on the
  // card header so high-volume players see stats at a glance.
  densityMode:    DensityMode
  // Leaver-handling preference (persisted via useLeaverHandling). The
  // FilterRail's segmented control only surfaces when at least one
  // record carries `annotation.leaver` — passed in via
  // `annotatedMatchCount` for the rendering gate.
  leaverHandling: 'include' | 'exclude-tally' | 'hide'
  // "Show hidden" toggle (persisted via useShowHidden). The
  // FilterRail's Hidden · N button only surfaces when
  // hiddenMatchCount > 0.
  showHidden: boolean
  // Index of the card the keyboard-shortcut dispatcher considers
  // "focused" (j/k advances this in App.vue). -1 = no card focused.
  // Optional so existing SFC tests that mount MatchesView without
  // the keyboard wiring still pass.
  focusedCardIndex?: number
}>()

const emit = defineEmits<{
  'go-to-view': [next: 'settings' | 'ingest' | 'matches' | 'unknown']
  'set-include-undated': [next: boolean]
  'set-min-play-percent': [n: number]
  'set-min-play-minutes': [n: number]
  'toggle-density':       []
  'set-leaver-handling':  [next: 'include' | 'exclude-tally' | 'hide']
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  'set-show-hidden':       [next: boolean]
  'set-match-hidden':      [matchKey: string, hidden: boolean]
  'card-focus':            [index: number]
}>()

// Pre-extracted destructures keep the template readable without
// reaching through `props.filters.modes` for every reference. Vue's
// reactivity stays intact because these are the same refs the parent
// owns — we're not unwrapping them.
const f = props.filters
const fp = props.filterPanel
const g = props.grouping
const cs = props.cardState

function setFilterFrom(v: string) { f.filterFrom.value = v }
function setFilterTo(v: string) { f.filterTo.value = v }
function setNoteSearch(v: string) { f.noteSearch.value = v }
function setFilterSearch(field: string, value: string) {
  fp.filterSearch.value = { ...fp.filterSearch.value, [field]: value }
}

function matchGroupKey(group: MatchGroup<MatchRecord>): string {
  return group.key
}

// Gate for the FilterRail's leaver-handling segmented control. Hides
// the control entirely when nobody has annotated any match yet — keeps
// the rail uncluttered until the feature is actually being used.
const annotatedMatchCount = computed(
  () => props.records.filter(r => !!r.annotation?.leaver).length,
)
</script>

<template>
  <div id="panel-matches" role="tabpanel" aria-labelledby="tab-matches" tabindex="-1" class="matches-view">
    <div v-if="records.length === 0 && !loading" class="empty">
      <div class="empty-mark">
        ◌
      </div>
      <p class="empty-title">
        No matches on record.
      </p>
      <p class="empty-sub">
        First-time setup runs left-to-right across the nav tabs:
      </p>
      <ol class="empty-steps">
        <li>
          <strong class="empty-step-num">01</strong>
          <span>Set your screenshots folder under <button type="button" class="empty-link" @click="emit('go-to-view', 'settings')">Settings</button>.</span>
        </li>
        <li>
          <strong class="empty-step-num">02</strong>
          <span>Locate Tesseract and click <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">Ingest → Run Parse</button>, or flip on <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">Watch Folder</button> to auto-ingest as you play.</span>
        </li>
        <li>
          <strong class="empty-step-num">03</strong>
          <span>Your matches appear here.</span>
        </li>
      </ol>
    </div>

    <FilterRail
      v-if="records.length > 0"
      :modes="f.modes.value"
      :maps="f.maps.value"
      :types="f.types.value"
      :roles="f.roles.value"
      :heroes="f.heroes.value"
      :results="f.results.value"
      :sshot-types="f.sshotTypes.value"
      :tags="f.tags.value"
      :note-search="f.noteSearch.value"
      :filter-list="f.filterList"
      :filter-search="fp.filterSearch.value"
      :open-filter="fp.openFilter.value"
      :filter-from="f.filterFrom.value"
      :filter-to="f.filterTo.value"
      :sort-dir="f.sortDir.value"
      :undated-match-count="f.undatedMatchCount.value"
      :any-filter="f.anyFilter.value"
      :earliest-match-date-time="earliestMatchDateTime"
      :now-date-time="nowDateTime"
      :all-expanded="cs.allExpanded.value"
      :record-count="records.length"
      :include-undated="includeUndated"
      :min-play-percent="minPlayPercent"
      :min-play-minutes="minPlayMinutes"
      :leaver-handling="leaverHandling"
      :annotated-match-count="annotatedMatchCount"
      :show-hidden="showHidden"
      :hidden-match-count="f.hiddenMatchCount.value"
      :filtered-count="f.filteredSorted.value.length"
      @update:filter-from="setFilterFrom"
      @update:filter-to="setFilterTo"
      @update:note-search="setNoteSearch"
      @update:search="setFilterSearch"
      @toggle-filter-panel="fp.toggleFilterPanel"
      @close-filter-panel="fp.closeFilterPanel"
      @toggle-filter="f.toggleFilter"
      @select-all-filter="f.selectAllFilter"
      @clear-filter-field="f.clearFilterField"
      @clear-filters="f.clearFilters"
      @reset-date-range="f.resetDateRange"
      @toggle-sort="f.toggleSort"
      @toggle-all="cs.toggleAll"
      @set-include-undated="(v: boolean) => emit('set-include-undated', v)"
      @set-min-play-percent="(n: number) => emit('set-min-play-percent', n)"
      @set-min-play-minutes="(n: number) => emit('set-min-play-minutes', n)"
      @set-leaver-handling="(v: 'include' | 'exclude-tally' | 'hide') => emit('set-leaver-handling', v)"
      @set-show-hidden="(v: boolean) => emit('set-show-hidden', v)"
    />

    <!-- Active-filter summary. Renders just below the FilterRail
         only when at least one filter is engaged. Each chip's ×
         removes that single filter; "Clear all" resets every
         active filter at once. -->
    <MatchesFilterPills
      v-if="records.length > 0"
      :modes="f.filterMode.value"
      :maps="f.filterMap.value"
      :types="f.filterType.value"
      :roles="f.filterRole.value"
      :heroes="f.filterHero.value"
      :results="f.filterResult.value"
      :sshots="f.filterSshot.value"
      :tags="f.filterTags.value"
      :note-search="f.noteSearch.value"
      :filter-from="f.filterFrom.value"
      :filter-to="f.filterTo.value"
      :any-filter="f.anyFilter.value"
      @remove-filter="f.toggleFilter"
      @clear-note-search="() => f.noteSearch.value = ''"
      @clear-date-range="f.resetDateRange"
      @clear-all="f.clearFilters"
    />

    <!-- Aggregate stats across the currently-filtered match set.
         Renders unconditionally above the list so the user always
         sees "what's true about this view" without scrolling into
         per-group tallies. -->
    <MatchesAggregateStats
      v-if="records.length > 0"
      :filtered="f.filteredSorted.value"
      :total-count="records.length"
      :skip-annotated-from-tally="leaverHandling === 'exclude-tally'"
    />

    <!-- Filtered-empty state — distinct from the first-run "no
         matches on record" path above. Standalone v-if (not chained
         to the AggregateStats v-if, which would create an unreachable
         branch). Surfaces only when records exist but every one has
         filtered out, so the user sees an explicit "filters narrowed
         everything away" message with a clear-all CTA instead of a
         blank scroll region. -->
    <div
      v-if="records.length > 0 && g.groups.value.length === 0 && f.anyFilter.value"
      class="filtered-empty"
      role="status"
    >
      <div class="filtered-empty-mark" aria-hidden="true">
        ⌀
      </div>
      <p class="filtered-empty-title">
        No matches fit these filters.
      </p>
      <p class="filtered-empty-sub">
        {{ records.length }} {{ records.length === 1 ? 'match' : 'matches' }} on record;
        {{ f.activeFilterCount.value }} active filter{{ f.activeFilterCount.value === 1 ? '' : 's' }} excluded all of them.
      </p>
      <button class="btn ghost" @click="f.clearFilters">
        Clear all filters
      </button>
    </div>

    <div v-if="records.length > 0 && g.groups.value.length > 0" class="match-list" :class="{ compact: densityMode === 'compact' }">
      <!-- Outline controls: Expand-all / Collapse-all toggle the whole
           Month → Week → Day tree at once. Sits above the groups so
           it's reachable without scrolling. -->
      <div class="group-rail" role="toolbar" aria-label="Group outline controls">
        <span class="group-rail-label">
          {{ g.groups.value.length }} {{ g.groups.value.length === 1 ? 'month' : 'months' }}
        </span>
        <button
          type="button"
          class="group-rail-btn density-btn"
          :class="{ active: densityMode === 'compact' }"
          :aria-pressed="densityMode === 'compact'"
          :title="densityMode === 'compact' ? 'Switch back to comfortable density' : 'Switch to compact density (one-line cards + inline stats)'"
          @click="emit('toggle-density')"
        >
          <span class="density-glyph" aria-hidden="true">{{ densityMode === 'compact' ? '▤' : '▥' }}</span>
          {{ densityMode === 'compact' ? 'Compact' : 'Comfy' }}
        </button>
        <button
          v-if="g.allExpanded.value"
          type="button"
          class="group-rail-btn"
          @click="g.collapseAll"
        >
          ▾ Collapse all
        </button>
        <button
          v-else
          type="button"
          class="group-rail-btn"
          @click="g.expandAll"
        >
          ▸ Expand all
        </button>
      </div>

      <MatchGroupSection
        v-for="(group, idx) in g.groups.value"
        :key="matchGroupKey(group)"
        :group="group"
        :is-group-expanded="g.isGroupExpanded"
        :is-expanded="cs.isExpanded"
        :is-sources-open="cs.isSourcesOpen"
        :preview-open="cs.previewOpen.value"
        :preview-error="cs.previewError.value"
        :is-active="f.isActive"
        :card-offset="idx"
        :density-mode="densityMode"
        :focused-card-index="focusedCardIndex"
        :note-search="f.noteSearch.value"
        @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
        @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
        @set-match-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
        @toggle-group="g.toggleGroup"
        @toggle-expand="cs.toggleExpand"
        @toggle-sources="cs.toggleSources"
        @toggle-preview="cs.togglePreview"
        @preview-error="cs.onPreviewError"
        @filter-toggle="f.toggleFilter"
        @card-focus="(i: number) => emit('card-focus', i)"
      />
    </div>
  </div>
</template>

<style scoped>
/* ─── Onboarding empty state (numbered setup steps) ──────── */

/* Numbered setup steps shown in the Matches empty state — mirrors the
   nav-tab numbering (01/02/03) so the user reads "01 Settings → 02
   Ingest → 03 here" with no ambiguity. */
.empty-steps {
  list-style: none;
  margin: 1.1rem auto 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  max-width: 44ch;
  text-align: left;
}

.empty-steps li {
  display: grid;
  grid-template-columns: 2.2rem 1fr;
  gap: 0.65rem;
  align-items: baseline;
  color: var(--text-dim);
  font-size: 0.88rem;
  line-height: 1.45;
}

.empty-step-num {
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.72rem;
  letter-spacing: 0.18em;
  color: var(--accent);
  text-align: right;
}

.empty-steps strong.empty-link {
  color: var(--accent);
}

/* ─── Group outline rail (Month → Week → Day grouping picker) ─── */

.group-rail {
  display: flex;
  align-items: baseline;
  gap: 0.8rem;
  margin-bottom: 0.55rem;
  padding: 0.3rem 0;
  border-bottom: 1px solid var(--border);
}

.group-rail-label {
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.group-rail-btn {
  margin-left: auto;
  padding: 0.25rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  color: var(--text-dim);
  font-family: var(--mono);
  font-size: 0.7rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.group-rail-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}

.group-rail-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

/* Density toggle — same chip footprint as the other group-rail
   buttons, with an `active` state when compact density is on so it
   reads as a sticky toggle rather than a one-shot action. The
   little glyph + label flip per state to make the next click's
   destination obvious without needing a tooltip. */
.density-btn {
  margin-left: auto;
}

.density-btn.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}

.density-btn + .group-rail-btn {
  /* The Expand/Collapse button sits next to Density when both are
     present — separate visual unit, no margin-left:auto on it. */
  margin-left: 0.4rem;
}

.density-glyph {
  display: inline-block;
  margin-right: 0.3rem;
  font-size: 0.78rem;
  line-height: 1;
  transform: translateY(1px);
}

/* ─── Match list container ───────────────────────────────── */

.match-list {
  margin-top: 1.4rem;
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* Compact mode tightens vertical rhythm between cards — the cards
   themselves carry the density class for their internal compression. */
.match-list.compact {
  gap: 0.3rem;
}

/* ─── Filtered-empty state ────────────────────────────────
   Renders when records exist but every one filters out. Distinct
   from the first-run empty state — this is "your filters are too
   tight", not "you haven't parsed anything yet". CTA resets every
   active filter via clearFilters. */
.filtered-empty {
  margin-top: 1.6rem;
  padding: 1.6rem 1.4rem;
  background: var(--surface);
  border: 1px dashed var(--border-strong);
  border-radius: 2px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  animation: filtered-empty-in 240ms ease both;
}

.filtered-empty-mark {
  font-family: var(--mono);
  font-size: 2.4rem;
  line-height: 1;
  color: var(--text-faint);
  margin-bottom: 0.35rem;
}

.filtered-empty-title {
  margin: 0;
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.4rem;
  text-transform: uppercase;
  letter-spacing: 0.02em;
  color: var(--text);
}

.filtered-empty-sub {
  margin: 0 0 0.35rem;
  font-size: 0.86rem;
  color: var(--text-dim);
  max-width: 52ch;
}

@keyframes filtered-empty-in {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .filtered-empty { animation: none; }
}
</style>

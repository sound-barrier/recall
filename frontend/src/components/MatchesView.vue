<script setup lang="ts">
import type { Ref, ComputedRef } from 'vue'
import type { MatchRecord } from '../api'
import type { useMatchFilters } from '../composables/useMatchFilters'
import type { useFilterPanel } from '../composables/useFilterPanel'
import type { useMatchGrouping } from '../composables/useMatchGrouping'
import type { MatchGroup } from '../match-helpers'
import FilterRail from './FilterRail.vue'
import MatchGroupSection from './MatchGroupSection.vue'

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
  isExpanded:    (id: number) => boolean
  isSourcesOpen: (id: number) => boolean
  // Refs (not their unwrapped values) — they're nested inside an
  // object, so Vue's template auto-unwrap doesn't reach them at this
  // depth. Consumers access via `.value`.
  previewOpen:   Ref<Record<string, boolean>>
  previewError:  Ref<Record<string, boolean>>
  allExpanded:   Readonly<Ref<boolean> | ComputedRef<boolean>>
  toggleAll:     () => void
  toggleExpand:  (id: number) => void
  toggleSources: (id: number) => void
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
}>()

const emit = defineEmits<{
  'go-to-view': [next: 'settings' | 'ingest' | 'matches' | 'unknown']
  'set-include-undated': [next: boolean]
  'set-min-play-percent': [n: number]
  'set-min-play-minutes': [n: number]
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
function setFilterSearch(field: string, value: string) {
  fp.filterSearch.value = { ...fp.filterSearch.value, [field]: value }
}

function matchGroupKey(group: MatchGroup<MatchRecord>): string {
  return group.key
}
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
      :filtered-count="f.filteredSorted.value.length"
      @update:filter-from="setFilterFrom"
      @update:filter-to="setFilterTo"
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
    />

    <div v-if="records.length > 0 && g.groups.value.length > 0" class="match-list">
      <!-- Outline controls: Expand-all / Collapse-all toggle the whole
           Month → Week → Day tree at once. Sits above the groups so
           it's reachable without scrolling. -->
      <div class="group-rail" role="toolbar" aria-label="Group outline controls">
        <span class="group-rail-label">
          {{ g.groups.value.length }} {{ g.groups.value.length === 1 ? 'month' : 'months' }}
        </span>
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
        @toggle-group="g.toggleGroup"
        @toggle-expand="cs.toggleExpand"
        @toggle-sources="cs.toggleSources"
        @toggle-preview="cs.togglePreview"
        @preview-error="cs.onPreviewError"
        @filter-toggle="f.toggleFilter"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'

import type { MatchRecord } from '@/api-client'
import type { GroupBy, SortOrder } from '@/composables/matches/useMatchesGroup'
import { useMembersListWindow } from '@/composables/matches/useMembersListWindow'
import { useNarrow } from '@/composables/matches/useNarrow'
import type { PlayModePick, QueuePick } from '@/composables/matches/matchesNarrow.types'
import type { Density } from '@/composables/matches/useDensity'
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import type { SearchClause } from '@/match/search-query'
import MatchLeafRow from '@/components/matches/list/MatchLeafRow.vue'
import MatchesTable from '@/components/matches/list/MatchesTable.vue'
import MatchesEmptySuggestions from '@/components/matches/list/MatchesEmptySuggestions.vue'

type NarrowApi = ReturnType<typeof useMatchesNarrow>

// The set's members list — the leaf-row <ul> (comfortable / compact
// density) or the sortable data <table> (data density), with flat-mode
// virtualization, grouped-mode infinite scroll, and the empty state.
//
// Extracted from MatchesView so the view stays orchestration: the
// parent owns the head controls (sort / group / density), the
// bulk-action bar, selection state, and the row-event handlers; this
// component owns the rendering + windowing, reflects parent state via
// props, and signals intent via emits. The parent calls `expandWindowToAll`
// (exposed) to render the whole list before its jump-to-undated scroll.
const props = defineProps<{
  // The narrowed record set, in App.vue's keyboard-nav order. Grouped +
  // sorted for display internally; data-card-index reflects THIS order.
  records: MatchRecord[]
  groupBy: GroupBy
  sortOrder: SortOrder
  density: Density
  // App.vue's j/k focus index — the matching row gets aria-current.
  focusedCardIndex?: number
  selectedKeys: Set<string>
  anchorKey: string | null
  searchClauses: SearchClause[]
  anyNarrow: boolean
  clauseExclusionCounts: NarrowApi['clauseExclusionCounts']['value']
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'toggle-select': [matchKey: string]
  'row-context': [event: MouseEvent, matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
  'reset-narrow': []
  'export-csv': []
}>()

const records = toRef(props, 'records')
const groupBy = toRef(props, 'groupBy')
const sortOrder = toRef(props, 'sortOrder')
const narrow = useNarrow()

// Click-to-filter from a leaf-row cell (cozy/compact): every value cell toggles
// its narrow dimension. Sorting is the sort/group toolbar's job, not a click.
function onFilterCell(field: 'map' | 'mode' | 'queue' | 'hero' | 'role' | 'result', value: string) {
  if (!value) return
  if (field === 'map') narrow.pickMap(value)
  else if (field === 'mode') narrow.pickPlayMode(value as PlayModePick)
  else if (field === 'queue') narrow.pickQueue(value as QueuePick)
  else if (field === 'hero') narrow.pickHero(value)
  else if (field === 'role') narrow.pickRole(value)
  else narrow.pickResult(value)
}

// The active narrow picks — passed to each row so a value cell whose value is
// currently filtered lights up (the active-filter state).
const activeFilters = computed(() => ({
  maps: narrow.pickedMaps.value as ReadonlySet<string>,
  modes: narrow.pickedPlayModes.value as ReadonlySet<string>,
  queues: narrow.pickedQueues.value as ReadonlySet<string>,
  heroes: narrow.pickedHeroes.value as ReadonlySet<string>,
  roles: narrow.pickedRoles.value as ReadonlySet<string>,
  results: narrow.pickedResults.value as ReadonlySet<string>,
}))

// Sort/group → collapse → paginate (grouped) or virtualize (flat) → render shape,
// plus the infinite-scroll IntersectionObserver and j/k auto-scroll, all live in
// useMembersListWindow. The SFC keeps only props, click-to-filter, and markup.
const {
  sortedRecords,
  renderSections,
  flatVirtualization,
  flatTopSpacerHeight,
  flatBottomSpacerHeight,
  leavesListRef,
  sentinelRef,
  isCollapsed,
  toggleSection,
  sectionTotal,
  narrowedIndexByKey,
  renderedCount,
  hasMore,
  resetCounter,
  expandWindowToAll,
  collapseAllSections,
  expandAllSections,
} = useMembersListWindow(
  records,
  groupBy,
  sortOrder,
  toRef(props, 'density'),
  toRef(props, 'focusedCardIndex'),
)

defineExpose({ expandWindowToAll, collapseAllSections, expandAllSections })
</script>

<template>
  <ul
    v-if="density !== 'data' && sortedRecords.length"
    ref="leavesListRef"
    class="leaves-list"
    :class="`density-${density}`"
    role="list"
  >
    <!-- Virtualization spacers. Non-zero only when groupBy='none';
       height equals the count of unmounted rows above (or below) the
       visible slice times the measured row height. Holds the scrollbar
       in place so the document still scrolls through every row even
       though most aren't in the DOM. -->
    <li
      v-if="flatTopSpacerHeight > 0"
      class="leaves-virtual-spacer"
      aria-hidden="true"
      :style="{ height: flatTopSpacerHeight + 'px' }"
      data-virt-top-spacer
    />
    <template v-for="section in renderSections" :key="section.key">
      <li v-if="section.header" class="section-divider" :data-section-key="section.key">
        <button
          type="button"
          class="sd-toggle"
          :aria-expanded="!isCollapsed(section.key)"
          :aria-label="`${isCollapsed(section.key) ? 'Expand' : 'Collapse'} ${section.header} group`"
          :data-section-toggle="section.key"
          @click="toggleSection(section.key)"
        >
          <span class="sd-chevron" :class="{ 'sd-chevron-collapsed': isCollapsed(section.key) }" aria-hidden="true">▾</span>
          <span class="sd-label">{{ section.header }}</span>
          <span class="sd-count">{{ sectionTotal(section.key) }}</span>
        </button>
        <span class="sd-line" aria-hidden="true" />
      </li>
      <template v-if="!isCollapsed(section.key)">
        <MatchLeafRow
          v-for="rec in section.records"
          :key="rec.match_key"
          :rec="rec"
          :card-index="narrowedIndexByKey.get(rec.match_key) ?? -1"
          :focused-card-index="props.focusedCardIndex"
          :selected="selectedKeys.has(rec.match_key)"
          :has-selection="selectedKeys.size > 0"
          :is-anchor="rec.match_key === anchorKey"
          :search-clauses="searchClauses"
          :active-filters="activeFilters"
          @filter-cell="onFilterCell"
          @open-match="emit('open-match', $event)"
          @toggle-select="emit('toggle-select', $event)"
          @row-context="(e, k) => emit('row-context', e, k)"
          @hover-enter="(r, e) => emit('hover-enter', r, e)"
          @hover-move="(e) => emit('hover-move', e)"
          @hover-leave="emit('hover-leave')"
        />
      </template>
    </template>
    <!-- Bottom virtualization spacer — counterpart to flatTopSpacerHeight. -->
    <li
      v-if="flatBottomSpacerHeight > 0"
      class="leaves-virtual-spacer"
      aria-hidden="true"
      :style="{ height: flatBottomSpacerHeight + 'px' }"
      data-virt-bottom-spacer
    />
    <!-- Infinite-scroll sentinel. Observed by an IntersectionObserver
       wired in onMounted; entering the viewport bumps the window by
       another page. Skipped when flat-mode virtualization is active. -->
    <li
      v-if="hasMore && !flatVirtualization"
      ref="sentinelRef"
      class="leaves-sentinel"
      aria-hidden="true"
      data-testid="leaves-sentinel"
    />
    <!-- Honest count for screen readers AND sighted users. -->
    <li
      class="leaves-foot"
      role="status"
      aria-live="polite"
      data-testid="leaves-foot"
    >
      <span v-if="hasMore && !flatVirtualization">
        Showing {{ renderedCount }} of {{ sortedRecords.length }} matches
      </span>
      <span v-else class="leaves-foot-end">
        <span class="leaves-foot-rule" aria-hidden="true" />
        End · {{ sortedRecords.length }}
        {{ sortedRecords.length === 1 ? 'match' : 'matches' }}
        <span class="leaves-foot-rule" aria-hidden="true" />
      </span>
    </li>
  </ul>

  <!-- Data density — the full narrowed set as a sortable, virtualized table. -->
  <MatchesTable
    v-else-if="density === 'data' && sortedRecords.length"
    :records="sortedRecords"
    :reset-counter="resetCounter"
    :focused-card-index="focusedCardIndex"
    :selected-keys="selectedKeys"
    :anchor-key="anchorKey"
    :search-clauses="searchClauses"
    :narrowed-index-by-key="narrowedIndexByKey"
    @open-match="(k) => emit('open-match', k)"
    @toggle-select="(k) => emit('toggle-select', k)"
    @row-context="(e, k) => emit('row-context', e, k)"
    @hover-enter="(r, e) => emit('hover-enter', r, e)"
    @hover-move="(e) => emit('hover-move', e)"
    @hover-leave="emit('hover-leave')"
    @export-csv="emit('export-csv')"
  />

  <p v-else class="leaves-empty">
    No matches in this set.
    <button v-if="anyNarrow" class="leaves-empty-btn" @click="emit('reset-narrow')">
      Clear narrowing
    </button>
    <MatchesEmptySuggestions
      v-if="anyNarrow"
      :suggestions="clauseExclusionCounts.slice(0, 2)"
    />
  </p>
</template>

<style scoped>
.leaves-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* Flat-mode virtualization spacers. Pure height — no border,
   no background, no content. Their job is to make the
   scroll-bar represent the full corpus while only the in-
   viewport slice of leaf-rows is in the DOM. */
.leaves-virtual-spacer {
  list-style: none;
  flex-shrink: 0;
  pointer-events: none;
}

.section-divider {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0 0.15rem;
}
.section-divider:first-child { padding-top: 0.1rem; }

/* The header doubles as a disclosure toggle — click (or Enter/Space)
   collapses the group to just this row, click again re-expands. */
.sd-toggle {
  appearance: none;
  background: transparent;
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.12rem 0.45rem 0.12rem 0.25rem;
  margin: 0;
  cursor: pointer;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
  border-radius: 3px;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}

.sd-toggle:hover {
  background: color-mix(in srgb, var(--accent) 8%, transparent);
  border-color: var(--accent-soft, var(--border));
  color: var(--text);
}

.sd-toggle:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 28%, transparent);
}

.sd-chevron {
  display: inline-block;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
  transition: transform 160ms ease;
}
.sd-chevron-collapsed { transform: rotate(-90deg); }

@media (prefers-reduced-motion: reduce) {
  .sd-chevron { transition: none; }
}

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


/* Compact density — tightens vertical rhythm so more rows fit on
   screen without going full data-table mode. Only the spacing and
   strip height change; grid template, fonts, and result-chip
   geometry stay so the eye reads rows the same way. */
.leaves-list.density-compact :deep(.leaf-row) {
  padding: 0.3rem 0.85rem;
  gap: 0.65rem;
}
.leaves-list.density-compact :deep(.leaf-strip) { height: 26px; }


/* ─── Data density — the sortable match <table> ───────────────────
   A real semantic table replaces the leaf-row <ul> when density is
   `data`: hairline rows, a sticky sortable header, monospace cells.
   Per-row + per-cell styling lives in MatchTableRow.vue (scoped to
   its own <tr>); these rules own the table frame + header. */

/* Bounded data-grid scroll pane — vertical (max-height) + horizontal
   (the table's min-width) scrolling in one box, so the uppercase header
   stays pinned (sticky to THIS pane) while wide rows scroll sideways. */


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
   visual "you've reached more rows" affordance is the foot below it. */
.leaves-sentinel {
  height: 1px;
  margin: 0;
  padding: 0;
  list-style: none;
}

/* "Showing N of M" foot. Visually subdued — same tone as the
   empty-state copy — so it sits below the rows without competing
   with the result chips above. */
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

/* End-of-results decoration. Em-dash rules flank the final count
   so the user gets a clear visual boundary instead of empty space
   below the last row. Only renders on the "no-more-to-load" state;
   the progressive "showing X of Y" line stays plain. */
.leaves-foot-end {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}

.leaves-foot-rule {
  display: inline-block;
  width: 1.8rem;
  height: 1px;
  background: currentcolor;
  opacity: 0.5;
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
</style>

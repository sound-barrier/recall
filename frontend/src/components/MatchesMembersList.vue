<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, toRef, watch } from 'vue'

import type { MatchRecord } from '../api'
import { useMatchesGroup, type GroupBy, type GroupedSection, type SortOrder } from '../composables/useMatchesGroup'
import { useMatchesWindow } from '../composables/useMatchesWindow'
import { useVirtualWindow } from '../composables/useVirtualWindow'
import { useTableSort, type TableSortCol } from '../composables/useTableSort'
import type { Density } from '../composables/useDensity'
import type { useMatchesNarrow } from '../composables/useMatchesNarrow'
import type { SearchClause } from '../search-query'
import MatchLeafRow from './MatchLeafRow.vue'
import MatchTableRow from './MatchTableRow.vue'
import MatchesEmptySuggestions from './MatchesEmptySuggestions.vue'

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
}>()

const records = toRef(props, 'records')
const groupBy = toRef(props, 'groupBy')
const sortOrder = toRef(props, 'sortOrder')

// ─── Sort + group via useMatchesGroup composable ───────────
const { sortedRecords, groupedSections } = useMatchesGroup(records, groupBy, sortOrder)

// ─── Data-density table: per-column sort ──────────────────
// Data density is a flat spreadsheet — the active column header sorts the
// WHOLE table (no grouping). Only the `data` density reads this engine;
// the leaf-row list (above) keeps its own Y/M/W/D grouping.
const { sortCol, sortDir, cycleSort, ariaSort, sortRows } = useTableSort()

// ─── Infinite-scroll window over the grouped sections ──────
//
// Renders only the first `renderedCount` rows; an
// IntersectionObserver sentinel below the rendered set bumps the
// window by another page when the user scrolls into it. Reset
// triggers (narrow change, sort change, group change, parse
// refresh) snap back to one page + scroll the list to top via
// the resetCounter watcher below.
const focusedCardIndexRef = computed(() => props.focusedCardIndex ?? -1)
const {
  renderedCount,
  hasMore,
  bumpWindow,
  expandWindowToAll,
  resetCounter,
} = useMatchesWindow(records, [sortOrder, groupBy], focusedCardIndexRef)

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

// IntersectionObserver wiring lives in onMounted / onBeforeUnmount
// below — keeps the DOM-touching concern co-located with the
// leavesListRef declaration.
const leavesListRef = ref<HTMLUListElement | null>(null)
// Either the leaf list's <li> sentinel or the data table's <tr>
// sentinel binds here — only one renders per density, and the single
// IntersectionObserver re-observes whichever mounts.
const sentinelRef   = ref<HTMLElement | null>(null)
let sentinelObserver: IntersectionObserver | null = null

// ─── Flat-mode row virtualization ──────────────────────────────
//
// When the user picks groupBy='none', the leaves list is one
// uniform-height stack of rows. We render only the slice currently
// in (or near) the viewport via useVirtualWindow; spacer divs
// above + below the slice hold the scroll height stable so the
// page scrollbar still represents the full corpus. Grouped modes
// keep the existing pagination — section-divider mixed-height
// rows would need a different model.
const LEAF_ROW_HEIGHT_DEFAULT = 58
const LEAF_ROW_HEIGHT_COMPACT = 38
const leafRowHeight = ref(LEAF_ROW_HEIGHT_DEFAULT)

const flatVirtualization = computed(() => props.groupBy === 'none')

const flatVirtual = useVirtualWindow({
  items:        sortedRecords,
  containerRef: leavesListRef,
  mode:         'window',
  itemHeight:   LEAF_ROW_HEIGHT_DEFAULT,
  overscan:     8,
})

// Render-time section list. Grouped: existing windowedSections
// (paginated). Flat: a single synthetic section carrying only the
// virtualizer's visible slice. The template iterates this shape
// either way so the leaf-row body stays in one place.
const renderSections = computed<GroupedSection[]>(() => {
  if (!flatVirtualization.value) return windowedSections.value
  return [{
    key:     'all',
    header:  null,
    records: flatVirtual.visibleItems.value as MatchRecord[],
  }]
})

// Spacer heights — non-zero only in flat virtualization.
const flatTopSpacerHeight    = computed(() => flatVirtualization.value ? flatVirtual.topSpacer.value    : 0)
const flatBottomSpacerHeight = computed(() => flatVirtualization.value ? flatVirtual.bottomSpacer.value : 0)

// Re-measure the row height after the first virtualized render so
// the math reflects the actual rendered geometry — density modes
// ship different row heights, and theme-level font-size overrides
// would otherwise leave us computing windows against a stale constant.
function measureLeafHeight(): void {
  if (!flatVirtualization.value) return
  const el = leavesListRef.value?.querySelector<HTMLElement>('.leaf-row')
  if (!el) return
  const measured = Math.round(el.getBoundingClientRect().height) + 2 // +2 for flex gap
  if (measured > 20 && Math.abs(measured - leafRowHeight.value) > 1) {
    leafRowHeight.value = measured
  }
}

// When the user toggles between virtualization-on and -off, reset
// the constant to a sensible per-density baseline so the first paint
// after the toggle uses the right value before the measure catches up.
watch([flatVirtualization, () => props.density], () => {
  leafRowHeight.value = props.density === 'compact' ? LEAF_ROW_HEIGHT_COMPACT : LEAF_ROW_HEIGHT_DEFAULT
})

// ─── Data-density table renderer ───────────────────────────────
//
// The `data` density swaps the leaf-row <ul> for a real <table>
// (sortable column headers + MatchTableRow rows): a flat spreadsheet
// where the active column header sorts the WHOLE table, virtualized
// through its own window. Table rows are far shorter than leaf rows, so
// this needs a dedicated itemHeight + spacer <tr>s rather than reusing
// the leaf virtualizer.
//
// The sortable columns, in render order. `col` is the TableSortCol a
// header sorts by (null = the non-sortable checkbox gutter).
const TABLE_COLUMNS: ReadonlyArray<{ col: TableSortCol | null; label: string }> = [
  { col: null,           label: '' },
  { col: 'date',         label: 'When' },
  { col: 'map',          label: 'Map' },
  { col: 'mode',         label: 'Mode' },
  { col: 'hero',         label: 'Hero' },
  { col: 'role',         label: 'Role' },
  { col: 'eliminations', label: 'E / A / D' },
  { col: 'tags',         label: 'Tags' },
  { col: 'result',       label: 'Result' },
]

const TABLE_ROW_HEIGHT = 30
const isDataDensity = computed(() => props.density === 'data')
// The Data table is a bounded scroll PANE (vertical + horizontal) so the
// header stays pinned while wide rows scroll sideways. The pane is the
// virtualization scroll container.
const tableScrollRef = ref<HTMLElement | null>(null)

// Data density is a flat spreadsheet: the active column header sorts the
// WHOLE table — no D/W/M/Y grouping. sortRows over the full narrowed set.
const tableFlatRecords = computed(() => sortRows(sortedRecords.value))
const tableVirtual = useVirtualWindow({
  items:        tableFlatRecords,
  containerRef: tableScrollRef,
  mode:         'container',
  itemHeight:   TABLE_ROW_HEIGHT,
  overscan:     12,
})
const tableFlatRows     = computed(() => (isDataDensity.value ? (tableVirtual.visibleItems.value as MatchRecord[]) : []))
const tableTopSpacer    = computed(() => (isDataDensity.value ? tableVirtual.topSpacer.value : 0))
const tableBottomSpacer = computed(() => (isDataDensity.value ? tableVirtual.bottomSpacer.value : 0))

// The toolbar's Newest/Oldest seeds the When column's direction — Data
// view has no separate sort control, the column headers ARE the sort.
// Picking Newest/Oldest snaps the table back to a date sort in that
// direction; clicking another header overrides until next pick.
watch(() => props.sortOrder, (o) => {
  sortCol.value = 'date'
  sortDir.value = o === 'newest' ? 'desc' : 'asc'
}, { immediate: true })

// Auto-scroll an off-window focused row into view when App.vue's
// j/k keyboard nav advances focusedCardIndex past the rendered slice.
watch(() => props.focusedCardIndex, async (idx) => {
  if (!flatVirtualization.value) return
  if (idx === undefined || idx < 0) return
  const list = leavesListRef.value
  if (!list) return
  const rowHeight = leafRowHeight.value
  const listTop = list.getBoundingClientRect().top + window.scrollY
  const rowTop  = listTop + idx * rowHeight
  const viewTop    = window.scrollY
  const viewBottom = window.scrollY + window.innerHeight
  // Generous slack — only scroll when the row would otherwise be
  // entirely above or below the viewport.
  if (rowTop >= viewTop + 80 && rowTop + rowHeight <= viewBottom - 80) return
  const target = rowTop - window.innerHeight / 3
  window.scrollTo({ top: Math.max(0, target), behavior: 'auto' })
})

// Reset → scroll the leaves list back to the top. In flat
// virtualization the list is in normal document flow, so resetting
// the list's own scrollTop is a no-op — scroll the document up to the
// list's top instead, with a small offset for the chrome above.
watch(resetCounter, () => {
  // Data density: the table is its own bounded scroll pane — reset its
  // scrollTop (both axes) rather than the document.
  if (isDataDensity.value) {
    tableScrollRef.value?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
    return
  }
  if (flatVirtualization.value) {
    const list = leavesListRef.value
    if (list) {
      const top = list.getBoundingClientRect().top + window.scrollY
      // Only pull the document up to the list when the user is already
      // scrolled into it. A reset fired while they're ABOVE the list —
      // drilling the dossier heatmap, clicking a Campaign Log day — must
      // not yank them down to the list top.
      if (window.scrollY > top - 80) {
        window.scrollTo({ top: Math.max(0, top - 80), behavior: 'auto' })
      }
    }
    return
  }
  leavesListRef.value?.scrollTo({ top: 0, behavior: 'auto' })
})

// Index every visible leaf-row by its position in the narrowed set so
// App.vue's j/k keyboard nav (which walks the same set) can target the
// matching row via `data-card-index`.
const narrowedIndexByKey = computed(() => {
  const m = new Map<string, number>()
  records.value.forEach((r, i) => m.set(r.match_key, i))
  return m
})

onMounted(() => {
  // IntersectionObserver for the infinite-scroll sentinel. The
  // sentinel only mounts while `hasMore` is true, so we watch the ref
  // and re-observe on (re)mount. rootMargin pre-loads the next page
  // just before the user reaches the tail.
  watch(sentinelRef, (el, prev) => {
    if (prev && sentinelObserver) sentinelObserver.unobserve(prev)
    if (!el) return
    if (!sentinelObserver) {
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

  // Measure leaf-row height after first paint, then re-measure when the
  // rendered slice changes (density swap, narrow apply shrinking to a
  // single row) so the constant stays calibrated.
  void nextTick().then(measureLeafHeight)
  watch(
    [() => flatVirtual.visibleItems.value.length, () => props.density],
    () => { void nextTick().then(measureLeafHeight) },
  )
})

onBeforeUnmount(() => {
  sentinelObserver?.disconnect()
  sentinelObserver = null
})

defineExpose({ expandWindowToAll })
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
      <li v-if="section.header" class="section-divider" :data-section-key="section.key" :aria-label="`Group: ${section.header}`">
        <span class="sd-label">{{ section.header }}</span>
        <span class="sd-count">{{ section.records.length }}</span>
        <span class="sd-line" aria-hidden="true" />
      </li>
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
        @open-match="emit('open-match', $event)"
        @toggle-select="emit('toggle-select', $event)"
        @row-context="(e, k) => emit('row-context', e, k)"
        @hover-enter="(r, e) => emit('hover-enter', r, e)"
        @hover-move="(e) => emit('hover-move', e)"
        @hover-leave="emit('hover-leave')"
      />
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

  <!-- Data density — a real <table> with sortable column headers.
     Mirrors the leaf list's two render paths: grouped (one <tbody> per
     Y/M/W/D bucket, rows sorted within it) and flat (a single
     virtualized body with spacer <tr>s). -->
  <div
    v-else-if="density === 'data' && sortedRecords.length"
    ref="tableScrollRef"
    class="leaves-table-scroll"
  >
    <table class="leaves-table">
      <thead class="leaves-thead">
        <tr>
          <th
            v-for="column in TABLE_COLUMNS"
            :key="column.label || 'select'"
            scope="col"
            class="th"
            :class="{ 'th-sortable': !!column.col, 'th-active': !!column.col && sortCol === column.col }"
            :data-sort-col="column.col || undefined"
            :aria-sort="column.col ? ariaSort(column.col) : undefined"
            @click="column.col && cycleSort(column.col)"
          >
            <span v-if="column.label" class="th-inner">
              {{ column.label }}
              <span
                v-if="!!column.col && sortCol === column.col"
                class="th-caret"
                aria-hidden="true"
              >{{ sortDir === 'asc' ? '▲' : '▼' }}</span>
            </span>
          </th>
        </tr>
      </thead>

      <!-- Always flat in Data density: one virtualized body, sorted by the
       active column header. Spacer <tr>s above + below the rendered
       slice hold the pane's scroll height stable. -->
      <tbody>
        <tr
          v-if="tableTopSpacer > 0"
          class="table-spacer"
          aria-hidden="true"
          :style="{ height: tableTopSpacer + 'px' }"
          data-virt-top-spacer
        >
          <td :colspan="TABLE_COLUMNS.length" />
        </tr>
        <MatchTableRow
          v-for="rec in tableFlatRows"
          :key="rec.match_key"
          :rec="rec"
          :card-index="narrowedIndexByKey.get(rec.match_key) ?? -1"
          :focused-card-index="props.focusedCardIndex"
          :selected="selectedKeys.has(rec.match_key)"
          :has-selection="selectedKeys.size > 0"
          :is-anchor="rec.match_key === anchorKey"
          :search-clauses="searchClauses"
          @open-match="emit('open-match', $event)"
          @toggle-select="emit('toggle-select', $event)"
          @row-context="(e, k) => emit('row-context', e, k)"
          @hover-enter="(r, e) => emit('hover-enter', r, e)"
          @hover-move="(e) => emit('hover-move', e)"
          @hover-leave="emit('hover-leave')"
        />
        <tr
          v-if="tableBottomSpacer > 0"
          class="table-spacer"
          aria-hidden="true"
          :style="{ height: tableBottomSpacer + 'px' }"
          data-virt-bottom-spacer
        >
          <td :colspan="TABLE_COLUMNS.length" />
        </tr>
      </tbody>

      <!-- Tail: honest count. Data density is fully virtualized (the whole
       set is scrollable in the pane), so there's no infinite-scroll
       paging here — just the end marker. -->
      <tfoot class="leaves-tfoot">
        <tr
          class="leaves-foot-row"
          role="status"
          aria-live="polite"
          data-testid="leaves-foot"
        >
          <td :colspan="TABLE_COLUMNS.length">
            <span class="leaves-foot-end">
              End · {{ sortedRecords.length }}
              {{ sortedRecords.length === 1 ? 'match' : 'matches' }}
            </span>
          </td>
        </tr>
      </tfoot>
    </table>
  </div>

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
.leaves-table-scroll {
  position: relative;
  overflow: auto;
  max-height: 70vh;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;

  /* Horizontal scroll-shadow: a faint fade appears at an edge only when
     there's more table past it. The `local` cover gradients ride with
     the content (hiding the shadow at the true edge); the `scroll`
     radial shadows stay pinned to the pane. Rows are transparent, so it
     reads through the body. */
  background:
    linear-gradient(90deg, var(--surface), transparent) 0 0 / 34px 100% no-repeat local,
    linear-gradient(270deg, var(--surface), transparent) 100% 0 / 34px 100% no-repeat local,
    radial-gradient(farthest-side at 0 50%, rgb(0 0 0 / 18%), transparent) 0 0 / 14px 100% no-repeat scroll,
    radial-gradient(farthest-side at 100% 50%, rgb(0 0 0 / 18%), transparent) 100% 0 / 14px 100% no-repeat scroll;
}

.leaves-table-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
.leaves-table-scroll::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }
.leaves-table-scroll::-webkit-scrollbar-thumb:hover { background: var(--accent); }
.leaves-table-scroll::-webkit-scrollbar-track { background: transparent; }

.leaves-table {
  width: 100%;

  /* Below this the pane scrolls horizontally instead of crushing the
     columns; nowrap cells + the map/hero/tags ellipsis do the rest. */
  min-width: 46rem;
  border-collapse: collapse;
  font-family: var(--mono);
}

.leaves-thead .th {
  position: sticky;
  top: 0;
  z-index: 2;
  text-align: left;
  padding: 0.5rem 0.55rem;
  font-size: 0.56rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 700;
  color: var(--text-faint);
  background: var(--surface-2);
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
  user-select: none;
}
.leaves-thead .th[data-sort-col="result"] { text-align: right; }
.leaves-thead .th[data-sort-col="result"] .th-inner { flex-direction: row-reverse; }

.th-sortable {
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}

.th-sortable:hover {
  color: var(--accent);
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
}
.th-active { color: var(--accent); }

.th-inner {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
}

.th-caret {
  font-size: 0.5rem;
  color: var(--accent);
}

/* Virtualization spacer rows — pure height, no chrome. */
.table-spacer { pointer-events: none; }
.table-spacer td { padding: 0; border: none; }

/* Tail foot row echoes the leaf-list foot tone. */
.leaves-foot-row td {
  padding: 0.9rem 0 1.1rem;
  text-align: center;
  font-size: 0.62rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-dim);
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

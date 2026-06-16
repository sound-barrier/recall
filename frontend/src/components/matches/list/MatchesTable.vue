<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MatchRecord } from '@/api'
import { useVirtualWindow } from '@/composables/matches/useVirtualWindow'
import { useTableSort, type TableSortCol, TABLE_SORT_COLUMNS } from '@/composables/matches/useTableSort'
import { useTableMode } from '@/composables/matches/useTableMode'
import type { SearchClause } from '@/match/search-query'
import MatchTableRow from '@/components/matches/list/MatchTableRow.vue'
import PivotTable from '@/components/matches/pivot/PivotTable.vue'

// Data-density view of the matches list: a real <table> with sortable
// column headers over the whole narrowed set (no D/W/M/Y grouping), the
// body virtualized inside a bounded scroll pane. Extracted from
// MatchesMembersList — rendered only in 'data' density — so it owns its own
// sort + virtualization + reset, and the parent threads the shared row
// props (selection, anchor, search highlight, keyboard focus) through.
const props = defineProps<{
  records: MatchRecord[]
  resetCounter: number
  focusedCardIndex?: number
  selectedKeys: Set<string>
  anchorKey: string | null
  searchClauses: SearchClause[]
  narrowedIndexByKey: Map<string, number>
}>()

const emit = defineEmits<{
  'open-match':    [matchKey: string]
  'toggle-select': [matchKey: string]
  'row-context':   [e: MouseEvent, matchKey: string]
  'hover-enter':   [rec: MatchRecord, e: MouseEvent]
  'hover-move':    [e: MouseEvent]
  'hover-leave':   []
  'export-csv':    []
}>()

// The render columns: the non-sortable checkbox gutter, then the shared
// sortable columns (TABLE_SORT_COLUMNS — the single source the Custom
// Sort dialog also reads).
const TABLE_COLUMNS: ReadonlyArray<{ col: TableSortCol | null; label: string }> = [
  { col: null, label: '' },
  ...TABLE_SORT_COLUMNS,
]
const TABLE_ROW_HEIGHT = 30

const { sortKeys, cycleSort, ariaSort, sortRows, sortLevelOf } = useTableSort()
const { tableMode, setTableMode } = useTableMode()

// Null-safe header-chrome adapters (the checkbox gutter column is col:
// null): the 1-based sort level for the badge, and the direction caret.
function headerLevel(col: TableSortCol | null): number {
  return col ? sortLevelOf(col) : 0
}
function headerCaret(col: TableSortCol | null): string {
  if (!col || sortLevelOf(col) === 0) return ''
  return ariaSort(col) === 'ascending' ? '▲' : '▼'
}

const records = computed(() => props.records)
const tableScrollRef = ref<HTMLElement | null>(null)
const tableFlatRecords = computed(() => sortRows(records.value))
const tableVirtual = useVirtualWindow({
  items:        tableFlatRecords,
  containerRef: tableScrollRef,
  mode:         'container',
  itemHeight:   TABLE_ROW_HEIGHT,
  overscan:     12,
})
const tableFlatRows     = computed(() => tableVirtual.visibleItems.value as MatchRecord[])
const tableTopSpacer    = computed(() => tableVirtual.topSpacer.value)
const tableBottomSpacer = computed(() => tableVirtual.bottomSpacer.value)

// Reset → scroll the table pane back to the top (both axes).
watch(() => props.resetCounter, () => {
  tableScrollRef.value?.scrollTo({ top: 0, left: 0, behavior: 'auto' })
})
</script>

<template>
  <div class="leaves-table-wrap">
    <div class="tablemode-bar">
      <div class="seg" role="group" aria-label="Table view mode">
        <button
          type="button"
          class="seg-btn"
          :class="{ 'seg-btn-active': tableMode === 'flat' }"
          :aria-pressed="tableMode === 'flat'"
          data-table-mode-pick="flat"
          @click="setTableMode('flat')"
        >
          Flat
        </button>
        <button
          type="button"
          class="seg-btn"
          :class="{ 'seg-btn-active': tableMode === 'pivot' }"
          :aria-pressed="tableMode === 'pivot'"
          data-table-mode-pick="pivot"
          @click="setTableMode('pivot')"
        >
          Pivot
        </button>
      </div>
      <button
        type="button"
        class="export-csv-btn"
        data-testid="export-csv"
        @click="emit('export-csv')"
      >
        Export CSV
      </button>
    </div>

    <div v-if="tableMode === 'flat'" ref="tableScrollRef" class="leaves-table-scroll">
      <table class="leaves-table">
        <thead class="leaves-thead">
          <tr>
            <th
              v-for="column in TABLE_COLUMNS"
              :key="column.label || 'select'"
              scope="col"
              class="th"
              :class="{ 'th-sortable': !!column.col, 'th-active': headerLevel(column.col) > 0 }"
              :data-sort-col="column.col || undefined"
              :aria-sort="column.col ? ariaSort(column.col) : undefined"
              :title="column.col ? 'Click to sort · Shift+click to add a level' : undefined"
              @click="column.col && cycleSort(column.col, { append: $event.shiftKey })"
            >
              <span v-if="column.label" class="th-inner">
                {{ column.label }}
                <span
                  v-if="headerLevel(column.col) > 0 && sortKeys.length > 1"
                  class="th-level"
                  aria-hidden="true"
                >{{ headerLevel(column.col) }}</span>
                <span
                  v-if="headerCaret(column.col)"
                  class="th-caret"
                  aria-hidden="true"
                >{{ headerCaret(column.col) }}</span>
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
                End · {{ records.length }}
                {{ records.length === 1 ? 'match' : 'matches' }}
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>

    <PivotTable v-else :records="records" />
  </div>
</template>

<style scoped>
.leaves-table-wrap {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.tablemode-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.seg {
  display: inline-flex;
  border: 1px solid var(--border);
  border-radius: 4px;
  overflow: hidden;
}

.seg-btn {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  padding: 0.3rem 0.7rem;
  color: var(--text-faint);
  background: var(--surface-2);
  border: none;
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}

.seg-btn + .seg-btn {
  border-left: 1px solid var(--border);
}

.seg-btn:hover {
  color: var(--accent);
}

.seg-btn-active {
  color: var(--primary-text-on-accent);
  background: var(--accent);
}

.export-csv-btn {
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 0.3rem 0.7rem;
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease;
}

.export-csv-btn:hover {
  color: var(--accent);
  border-color: var(--accent);
}

@media (prefers-reduced-motion: reduce) {
  .seg-btn,
  .export-csv-btn { transition: none; }
}

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
     columns; nowrap cells + the map/hero/tags ellipsis do the rest.
     Wider than the pre-split table — Mode/Queue and E/A/D each own a
     column now. */
  min-width: 64rem;
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

/* Numeric E / A / D headers right-align to sit over their tabular-num
   cells (MatchTableRow .tc-stat-cell). */
.leaves-thead .th[data-sort-col="eliminations"],
.leaves-thead .th[data-sort-col="assists"],
.leaves-thead .th[data-sort-col="deaths"] { text-align: right; }

.leaves-thead .th[data-sort-col="eliminations"] .th-inner,
.leaves-thead .th[data-sort-col="assists"] .th-inner,
.leaves-thead .th[data-sort-col="deaths"] .th-inner { flex-direction: row-reverse; }

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

/* Numbered badge marking a column's position in a multi-key sort stack;
   only rendered when more than one level is active. */
.th-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0.85rem;
  height: 0.85rem;
  padding: 0 0.15rem;
  font-size: 0.5rem;
  font-weight: 700;
  line-height: 1;
  color: var(--primary-text-on-accent);
  background: var(--accent);
  border-radius: 2px;
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

/* Shared with the leaf-list foot tone (kept in both scoped contexts). */
.leaves-foot-end {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
}
</style>

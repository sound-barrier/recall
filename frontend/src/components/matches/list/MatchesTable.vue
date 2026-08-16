<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useVirtualWindow } from '@/composables/matches/useVirtualWindow'
import { useTableSort, type TableSortCol, TABLE_SORT_COLUMNS } from '@/composables/matches/useTableSort'
import { useTableMode } from '@/composables/matches/useTableMode'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useColumnResize } from '@/composables/matches/useColumnResize'
import { useMatchClock } from '@/composables/shared/useMatchClock'
import { useCellDragSelect } from '@/composables/matches/useCellDragSelect'
import { useOWData } from '@/composables/shared/useOWData'
import { useAppStore } from '@/stores/app'
import type { PlayModePick, QueuePick } from '@/composables/matches/matchesNarrow.types'
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

const ow = useOWData()
const { sortKeys, cycleSort, ariaSort, sortRows, sortLevelOf } = useTableSort()
const { tableMode, setTableMode } = useTableMode()
const narrow = useNarrow()

// Click-to-filter: every value cell toggles its narrow dimension (sorting is the
// column headers' job). The active picks light the matching cells up.
function onFilterCell(field: 'map' | 'result' | 'mode' | 'queue' | 'hero' | 'role', value: string) {
  if (!value) return
  if (field === 'map') narrow.pickMap(value)
  else if (field === 'result') narrow.pickResult(value)
  else if (field === 'mode') narrow.pickPlayMode(value as PlayModePick)
  else if (field === 'queue') narrow.pickQueue(value as QueuePick)
  else if (field === 'hero') narrow.pickHero(value)
  else narrow.pickRole(value)
}

const activeFilters = computed(() => ({
  maps: narrow.pickedMaps.value as ReadonlySet<string>,
  modes: narrow.pickedPlayModes.value as ReadonlySet<string>,
  queues: narrow.pickedQueues.value as ReadonlySet<string>,
  heroes: narrow.pickedHeroes.value as ReadonlySet<string>,
  roles: narrow.pickedRoles.value as ReadonlySet<string>,
  results: narrow.pickedResults.value as ReadonlySet<string>,
}))

// Column resize: persisted per-column widths drive a <colgroup> over a
// fixed-layout table; the total feeds the table's own width so the pane scrolls
// horizontally once the columns outgrow it.
const { colWidth, onResizeStart, setWidth } = useColumnResize()
function colKey(column: { col: TableSortCol | null }): string {
  return column.col ?? 'select'
}

// Double-click a resize handle to size the column to its widest content — the
// rendered cells plus the header label — so nothing clips. A DOM Range measures
// the laid-out content width (correct even when the cell doesn't clip via
// overflow, unlike scrollWidth). The handle (7px, absolute) sits outside the
// measured content, so HANDLE_CLEARANCE keeps the text off it; MAX_AUTO_FIT caps
// a runaway (e.g. a long tag list).
const HANDLE_CLEARANCE = 12
const MAX_AUTO_FIT = 520
function measuredContentWidth(el: Element): number {
  const range = document.createRange()
  range.selectNodeContents(el)
  return range.getBoundingClientRect().width
}
function autoFitColumn(col: TableSortCol): void {
  const pane = tableScrollRef.value
  if (!pane) return
  const dataCol = TABLE_SORT_COLUMNS.findIndex((c) => c.col === col)
  let content = 0
  let pad = 0
  pane.querySelectorAll<HTMLElement>(`td[data-col="${dataCol}"]`).forEach((td) => {
    content = Math.max(content, measuredContentWidth(td))
    const cs = getComputedStyle(td)
    pad = Math.max(pad, parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight))
  })
  const inner = pane.querySelector(`th[data-sort-col="${col}"] .th-inner`)
  if (inner) content = Math.max(content, measuredContentWidth(inner))
  if (content > 0) setWidth(col, Math.min(Math.ceil(content + pad) + HANDLE_CLEARANCE, MAX_AUTO_FIT))
}
const tableWidth = computed(() => TABLE_COLUMNS.reduce((sum, c) => sum + colWidth(colKey(c)), 0))

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

// ─── Cell range-select + copy (TSV) ────────────────────────
// Drag a rectangle of cells, Ctrl/Cmd+C copies it as TSV for
// Excel/Sheets; a plain click still opens the row. The whole pointer
// state machine (threshold, edge auto-scroll, copy keybinding) lives
// in useCellDragSelect — this shell only binds its three outputs.
const tableCols = TABLE_SORT_COLUMNS.map((c) => c.col)
const appStore = useAppStore()
const matchClock = useMatchClock()
const { cellSel, onCellMouseDown, onRowOpen } = useCellDragSelect({
  rows: tableFlatRecords,
  cols: tableCols,
  heroRole: ow.heroRole,
  containerRef: tableScrollRef,
  onOpen: (key) => emit('open-match', key),
  onError: (message) => appStore.setErrorFromRaw(message),
  clock: matchClock,
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
      <span v-if="tableMode === 'flat'" class="cell-copy-hint" data-cell-copy-hint>
        Drag to select cells · <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>C</kbd> copies as TSV
      </span>
      <button
        type="button"
        class="export-csv-btn"
        data-testid="export-csv"
        @click="emit('export-csv')"
      >
        Export CSV
      </button>
    </div>

    <div
      v-if="tableMode === 'flat'"
      ref="tableScrollRef"
      class="leaves-table-scroll"
      :class="{ 'is-cell-dragging': cellSel.dragging.value }"
      @mousedown="onCellMouseDown"
    >
      <table class="leaves-table" :style="{ width: tableWidth + 'px' }">
        <colgroup>
          <col
            v-for="column in TABLE_COLUMNS"
            :key="colKey(column) + '-col'"
            :style="{ width: colWidth(colKey(column)) + 'px' }"
          >
        </colgroup>
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
              <span
                v-if="column.col"
                class="th-resize"
                aria-hidden="true"
                title="Drag to resize · double-click to fit contents"
                @pointerdown="onResizeStart(colKey(column), $event)"
                @dblclick.stop="column.col && autoFitColumn(column.col)"
                @click.stop
              />
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
            :active-filters="activeFilters"
            :selected-cols="cellSel.selectedColsFor(rec.match_key)"
            @filter-cell="onFilterCell"
            @open-match="onRowOpen"
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

<style scoped src="./matches-table.css"></style>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useVirtualWindow } from '@/composables/matches/useVirtualWindow'
import { useTableSort, type TableSortCol, TABLE_SORT_COLUMNS } from '@/composables/matches/useTableSort'
import { useTableMode } from '@/composables/matches/useTableMode'
import { useNarrow } from '@/composables/matches/useNarrow'
import { useColumnResize } from '@/composables/matches/useColumnResize'
import { useCellSelection } from '@/composables/matches/useCellSelection'
import { useOWData } from '@/composables/shared/useOWData'
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
// Drag a rectangle of cells, Ctrl/Cmd+C copies it as TSV for Excel/Sheets. A
// plain click (no drag) still opens the row; a drag selects the range.
const tableCols = TABLE_SORT_COLUMNS.map((c) => c.col)
const cellSel = useCellSelection(tableFlatRecords, tableCols, ow.heroRole)

// Resolve the cell under a pointer event — null on interactive children (so
// their own click still fires) or off-grid.
function cellAt(e: MouseEvent): { key: string; col: number } | null {
  const el = e.target as HTMLElement
  if (el.closest('button, input, a')) return null
  const td = el.closest<HTMLElement>('td[data-col]')
  const key = el.closest<HTMLElement>('tr[data-match-key]')?.dataset.matchKey
  if (!td || key == null) return null
  const col = Number(td.dataset.col)
  return Number.isNaN(col) ? null : { key, col }
}

// Re-resolve the cell at a viewport point — used by the auto-scroll to extend
// the selection to whatever scrolled under the held pointer.
function cellFromPoint(x: number, y: number): { key: string; col: number } | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el || el.closest('button, input, a')) return null
  const td = el.closest<HTMLElement>('td[data-col]')
  const key = el.closest<HTMLElement>('tr[data-match-key]')?.dataset.matchKey
  if (!td || key == null) return null
  const col = Number(td.dataset.col)
  return Number.isNaN(col) ? null : { key, col }
}

// Auto-scroll the pane while dragging near its top/bottom edge, so a selection
// can extend past the viewport (it stops on its own when the pointer leaves the
// edge or the drag ends).
let dragPoint = { x: 0, y: 0 }
let scrollRAF = 0
function autoScrollTick() {
  const pane = tableScrollRef.value
  if (!pane || !cellSel.dragging.value) { scrollRAF = 0; return }
  const rect = pane.getBoundingClientRect()
  const EDGE = 32
  const dir = dragPoint.y < rect.top + EDGE ? -1 : dragPoint.y > rect.bottom - EDGE ? 1 : 0
  if (dir === 0) { scrollRAF = 0; return }
  pane.scrollTop += dir * 14
  const cell = cellFromPoint(dragPoint.x, dragPoint.y)
  if (cell) cellSel.extendTo(cell.key, cell.col)
  scrollRAF = requestAnimationFrame(autoScrollTick)
}

// Only commit a selection once the pointer moves past a small threshold, so a
// click still falls through to the row's open-detail handler.
let pendingStart: { key: string; col: number; x: number; y: number } | null = null
let suppressNextOpen = false

function onCellMouseDown(e: MouseEvent) {
  if (e.button !== 0) return
  suppressNextOpen = false
  const cell = cellAt(e)
  if (!cell) return
  pendingStart = { ...cell, x: e.clientX, y: e.clientY }
  document.addEventListener('mousemove', onCellMouseMove)
  document.addEventListener('mouseup', onCellMouseUp, { once: true })
}
function onCellMouseMove(e: MouseEvent) {
  if (cellSel.dragging.value) {
    const cell = cellAt(e)
    if (cell) cellSel.extendTo(cell.key, cell.col)
    dragPoint = { x: e.clientX, y: e.clientY }
    if (!scrollRAF) scrollRAF = requestAnimationFrame(autoScrollTick)
    return
  }
  if (!pendingStart) return
  if (Math.abs(e.clientX - pendingStart.x) + Math.abs(e.clientY - pendingStart.y) < 4) return
  cellSel.startAt(pendingStart.key, pendingStart.col)
  const cell = cellAt(e)
  if (cell) cellSel.extendTo(cell.key, cell.col)
}
function onCellMouseUp() {
  document.removeEventListener('mousemove', onCellMouseMove)
  if (scrollRAF) { cancelAnimationFrame(scrollRAF); scrollRAF = 0 }
  if (cellSel.dragging.value) suppressNextOpen = true
  pendingStart = null
  cellSel.endDrag()
}
function onRowOpen(key: string) {
  if (suppressNextOpen) { suppressNextOpen = false; return }
  emit('open-match', key)
}

function isEditable(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
}
function onCellKeydown(e: KeyboardEvent) {
  if (!cellSel.hasSelection.value) return
  if (e.key === 'Escape') { cellSel.clear(); return }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isEditable(document.activeElement)) {
    e.preventDefault()
    void cellSel.copy()
  }
}
onMounted(() => document.addEventListener('keydown', onCellKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onCellKeydown))
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

/* No text selection while drag-selecting a cell range. */
.leaves-table-scroll.is-cell-dragging { user-select: none; }

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
  /* Width is the sum of the (resizable) column widths, set inline from the
     colgroup; fixed layout makes each <col> width authoritative so the pane
     scrolls horizontally once the columns outgrow it. nowrap cells + the
     map/hero/tags ellipsis clip overflow within each column. */
  table-layout: fixed;
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

/* Frozen leading columns: select + Date stay pinned-left while the wider
   columns scroll under them. select has no resize handle, so its width is the
   fixed 34px default and Date's offset is a constant 34px. The header cells are
   already sticky-top; adding `left` makes them sticky in both axes, and the
   bumped z-index keeps the frozen corner above the rest of the sticky header. */
.leaves-thead .th:first-child { left: 0; z-index: 3; }

.leaves-thead .th[data-sort-col="date"] {
  left: 34px;
  z-index: 3;
  border-right: 1px solid var(--border-strong);
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

/* Drag handle on each column's right edge (sits in the sticky th's containing
   block). Drag to resize, double-click to reset to the natural width. */
.th-resize {
  position: absolute;
  top: 0;
  right: 0;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  user-select: none;
  touch-action: none;
}
.th-resize:hover { background: color-mix(in srgb, var(--accent) 45%, transparent); }

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

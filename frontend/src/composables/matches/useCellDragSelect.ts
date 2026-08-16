import { onBeforeUnmount, onMounted, type Ref } from 'vue'

import { useCellSelection } from '@/composables/matches/useCellSelection'
import type { ClockMode } from '@/match/match-time-helpers'
import type { MatchRecord } from '@/api-client'
import type { TableSortCol } from '@/composables/matches/useTableSort'

// Mirrors useCellSelection's unexported alias — a resolver from hero
// name to role, supplied by useOWData's heroRole.
type HeroRole = (hero: string | null | undefined) => string

// -1 (scroll up) / 1 (scroll down) when the pointer sits within EDGE px
// of the pane's top/bottom edge; 0 keeps the pane still.
const EDGE = 32
function edgeScrollDirection(y: number, rect: DOMRect): number {
  if (y < rect.top + EDGE) return -1
  if (y > rect.bottom - EDGE) return 1
  return 0
}

// Pointer orchestration for the table's cell range-select + TSV copy:
// drag a rectangle of cells, Ctrl/Cmd+C copies it for Excel/Sheets,
// a plain click (no drag) still opens the row. Owns the inner
// useCellSelection instance plus everything around it — the
// pointer-threshold state machine, the edge auto-scroll RAF loop,
// the document-level copy/Escape keybinding — so MatchesTable keeps
// only the table markup and its chrome (ledger §10 adjudication:
// this was the one clean seam the 657-line SFC had left).
//
// The container ref is the scrollable pane: auto-scroll nudges it
// while a drag holds near its top/bottom edge, re-resolving the cell
// under the pointer so the selection extends past the viewport.
export function useCellDragSelect(opts: {
  rows: Ref<MatchRecord[]>
  cols: readonly TableSortCol[]
  heroRole: HeroRole
  containerRef: Ref<HTMLElement | null>
  onOpen: (matchKey: string) => void
  // Surface for a clipboard denial — the browsers that gate writeText
  // behind a permission reject the promise, and without a sink here the
  // user just sees a Ctrl+C that did nothing. MatchesTable wires this to
  // the app-store error banner, the same place every other clipboard
  // caller reports to.
  onError?: (message: string) => void
  /** The clock the table paints in — copied cells must match it. */
  clock?: Ref<ClockMode> | (() => ClockMode)
}) {
  const cellSel = useCellSelection(opts.rows, opts.cols, opts.heroRole, opts.clock)

  // Resolve the cell under a pointer event — null on interactive
  // children (so their own click still fires) or off-grid.
  function cellAt(e: MouseEvent): { key: string; col: number } | null {
    const el = e.target as HTMLElement
    if (el.closest('button, input, a')) return null
    const td = el.closest<HTMLElement>('td[data-col]')
    const key = el.closest<HTMLElement>('tr[data-match-key]')?.dataset.matchKey
    if (!td || key == null) return null
    const col = Number(td.dataset.col)
    return Number.isNaN(col) ? null : { key, col }
  }

  // Re-resolve the cell at a viewport point — used by the auto-scroll
  // to extend the selection to whatever scrolled under the held pointer.
  function cellFromPoint(x: number, y: number): { key: string; col: number } | null {
    const el = document.elementFromPoint(x, y) as HTMLElement | null
    if (!el || el.closest('button, input, a')) return null
    const td = el.closest<HTMLElement>('td[data-col]')
    const key = el.closest<HTMLElement>('tr[data-match-key]')?.dataset.matchKey
    if (!td || key == null) return null
    const col = Number(td.dataset.col)
    return Number.isNaN(col) ? null : { key, col }
  }

  // Auto-scroll the pane while dragging near its top/bottom edge, so a
  // selection can extend past the viewport (it stops on its own when
  // the pointer leaves the edge or the drag ends).
  let dragPoint = { x: 0, y: 0 }
  let scrollRAF = 0
  function autoScrollTick() {
    const pane = opts.containerRef.value
    if (!pane || !cellSel.dragging.value) { scrollRAF = 0; return }
    const rect = pane.getBoundingClientRect()
    const dir = edgeScrollDirection(dragPoint.y, rect)
    if (dir === 0) { scrollRAF = 0; return }
    pane.scrollTop += dir * 14
    const cell = cellFromPoint(dragPoint.x, dragPoint.y)
    if (cell) cellSel.extendTo(cell.key, cell.col)
    scrollRAF = requestAnimationFrame(autoScrollTick)
  }

  // Only commit a selection once the pointer moves past a small
  // threshold, so a click still falls through to the row's
  // open-detail handler.
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

  // A drag that just ended must not ALSO open the detail panel for
  // the row the pointer released on.
  function onRowOpen(key: string) {
    if (suppressNextOpen) { suppressNextOpen = false; return }
    opts.onOpen(key)
  }

  function isEditable(el: EventTarget | null): boolean {
    return el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  }
  function onCellKeydown(e: KeyboardEvent) {
    if (!cellSel.hasSelection.value) return
    if (e.key === 'Escape') { cellSel.clear(); return }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && !isEditable(document.activeElement)) {
      e.preventDefault()
      cellSel.copy().catch((err: unknown) => opts.onError?.(String(err)))
    }
  }
  onMounted(() => document.addEventListener('keydown', onCellKeydown))
  onBeforeUnmount(() => document.removeEventListener('keydown', onCellKeydown))

  return { cellSel, onCellMouseDown, onRowOpen }
}

import { ref, type Ref } from 'vue'

// Layout-aware DnD + keyboard reorder composable. Each "cell" the
// consumer renders knows its (row, idx) coordinates; the handlers
// returned here wire native HTML5 DnD events on a cell to a single
// `onMove` callback that the consumer pipes into a persistence
// layer (typically useDashboardLayout.move).
//
// Same-row reorder and cross-row move flow through the same path:
// the consumer's `onMove(id, fromRow, fromIdx, toRow, toIdx)` is
// the only emitted signal. Same-row reorder is the common case;
// cross-row drag (KPI → breakdown row) and keyboard ArrowDown/Up
// share the same callback.
//
// Keyboard alt is mandatory per .claude/rules/a11y.md — drag handles
// are <button> with full keyboard support. Arrow keys move the
// widget without involving DnD APIs at all, so screen-reader users
// (who can't initiate native drag) still get full functionality.

interface DragReorderCoord {
  id: string
  row: number
  idx: number
}

interface RowSize {
  // The current length of each row. Used to clamp keyboard ArrowDown
  // / ArrowUp + bound the "drop past the last cell" handler. The
  // consumer is the source of truth here; the composable doesn't
  // hold a copy of the layout.
  (row: number): number
}

interface AdjacentRowResolver {
  // Returns the row index immediately above (-1 direction) / below
  // (+1 direction) of `from`, or null when at the boundary. Phase 3
  // ships two rows, so this is simply "from-1 or null" / "from+1 or
  // null" — but the indirection lets Phase 4 plug in a sparse row
  // map (1, 2, 5, …) without re-plumbing keyboard handlers.
  (from: number, direction: -1 | 1): number | null
}

export interface UseDragReorderOptions {
  onMove: (id: string, fromRow: number, fromIdx: number, toRow: number, toIdx: number) => void
  rowSize: RowSize
  adjacentRow?: AdjacentRowResolver
}

export interface DragReorderApi {
  // Reactive state — consumers bind these to visual cues.
  dragging:  Ref<DragReorderCoord | null>
  dropHint:  Ref<{ row: number; idx: number } | null>
  // Drag-handle event handlers.
  onDragStart: (id: string, row: number, idx: number, e: DragEvent) => void
  onDragEnd:   () => void
  // Cell-level DnD targets.
  onDragOver:  (row: number, idx: number, e: DragEvent) => void
  onDrop:      (row: number, idx: number, e: DragEvent) => void
  // Row-container targets (catch drops past the last cell).
  onRowDragOver: (row: number, e: DragEvent) => void
  onRowDrop:     (row: number, e: DragEvent) => void
  // Keyboard alternative for the drag handle.
  //   ArrowLeft  → move one slot left in row
  //   ArrowRight → move one slot right in row
  //   ArrowUp    → adjacent row above, same idx (clamped)
  //   ArrowDown  → adjacent row below, same idx (clamped)
  //   Home/End   → row's first / last slot
  onHandleKeydown: (id: string, row: number, idx: number, e: KeyboardEvent) => void
}

export function useDragReorder(opts: UseDragReorderOptions): DragReorderApi {
  const dragging = ref<DragReorderCoord | null>(null)
  const dropHint = ref<{ row: number; idx: number } | null>(null)

  const adjacentRow: AdjacentRowResolver =
    opts.adjacentRow ?? ((from, direction) => from + direction)

  function onDragStart(id: string, row: number, idx: number, e: DragEvent) {
    dragging.value = { id, row, idx }
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
      // Some browsers refuse to initiate a drag if dataTransfer is
      // empty. Set a token (the widget id) for completeness — we
      // don't rely on this on drop because dragging.value carries
      // richer state.
      try { e.dataTransfer.setData('text/plain', id) } catch {/* ignored */}
    }
  }

  function onDragEnd() {
    dragging.value = null
    dropHint.value  = null
  }

  function onDragOver(row: number, idx: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault() // permit drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dropHint.value = { row, idx }
  }

  function onDrop(row: number, idx: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault()
    const { id, row: fromRow, idx: fromIdx } = dragging.value
    if (fromRow === row && fromIdx === idx) {
      onDragEnd()
      return
    }
    // Drag semantic: "drop on cell at original idx X" = "insert
    // before that cell". Translate to the post-removal idx the
    // layout's move() expects: same-row source-before-target
    // shifts the visible target down by 1 after we splice the
    // source out. Cross-row + same-row source-after target need
    // no adjustment.
    let toIdx = idx
    if (fromRow === row && fromIdx < idx) toIdx = idx - 1
    // Fire onMove BEFORE clearing dragging state so the consumer
    // can derive a live-preview commit (e.g. MatchesView's
    // preview-layout drag) from dragging + dropHint.
    opts.onMove(id, fromRow, fromIdx, row, toIdx)
    onDragEnd()
  }

  function onRowDragOver(row: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    // Only set the "append at end" hint when the event ORIGINATED on
    // the row container, not when it bubbled up from a child cell.
    // Without this guard, the per-cell dropHint set a moment earlier
    // gets clobbered on the bubble pass and the live-preview lands
    // every drag at the row tail.
    if (e.target !== e.currentTarget) return
    const size = opts.rowSize(row)
    dropHint.value = { row, idx: size }
  }

  function onRowDrop(row: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault()
    const { id, row: fromRow, idx: fromIdx } = dragging.value
    const targetIdx = opts.rowSize(row)
    // Fire onMove BEFORE onDragEnd — see onDrop's note for why.
    opts.onMove(id, fromRow, fromIdx, row, targetIdx)
    onDragEnd()
  }

  function onHandleKeydown(id: string, row: number, idx: number, e: KeyboardEvent) {
    let handled = true
    switch (e.key) {
      case 'ArrowLeft': {
        if (idx === 0) { handled = false; break }
        opts.onMove(id, row, idx, row, idx - 1)
        break
      }
      case 'ArrowRight': {
        const lastIdx = Math.max(0, opts.rowSize(row) - 1)
        if (idx >= lastIdx) { handled = false; break }
        opts.onMove(id, row, idx, row, idx + 1)
        break
      }
      case 'ArrowUp': {
        const upRow = adjacentRow(row, -1)
        if (upRow === null) { handled = false; break }
        const clampedIdx = Math.min(idx, opts.rowSize(upRow))
        opts.onMove(id, row, idx, upRow, clampedIdx)
        break
      }
      case 'ArrowDown': {
        const downRow = adjacentRow(row, 1)
        if (downRow === null) { handled = false; break }
        const clampedIdx = Math.min(idx, opts.rowSize(downRow))
        opts.onMove(id, row, idx, downRow, clampedIdx)
        break
      }
      case 'Home': {
        if (idx === 0) { handled = false; break }
        opts.onMove(id, row, idx, row, 0)
        break
      }
      case 'End': {
        const lastIdx = Math.max(0, opts.rowSize(row) - 1)
        if (idx >= lastIdx) { handled = false; break }
        opts.onMove(id, row, idx, row, lastIdx)
        break
      }
      default:
        handled = false
    }
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  return {
    dragging,
    dropHint,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    onRowDragOver,
    onRowDrop,
    onHandleKeydown,
  }
}

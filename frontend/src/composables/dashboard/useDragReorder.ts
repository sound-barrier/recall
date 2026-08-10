import { ref, type Ref } from 'vue'

// Layout-aware DnD + keyboard reorder composable. Each "cell" the
// consumer renders knows its (row, idx) coordinates; the handlers
// returned here wire native HTML5 DnD events on a cell to a single
// `onMove` callback that the consumer pipes into a persistence
// layer (typically useDashboardLayout.move).
//
// Same-row reorder and cross-row move flow through the same path:
// the consumer's `onMove(id, from, to)` is
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

// A (row, idx) cell coordinate — the shared vocabulary of onMove's
// source/destination legs and the dropHint.
export interface CellPos {
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
  onMove: (id: string, from: CellPos, to: CellPos) => void
  rowSize: RowSize
  adjacentRow?: AdjacentRowResolver
  // The class the consumer's <TransitionGroup> applies to cells during
  // a FLIP move transition (its `${name}-move` class). When set, a
  // dragover from a cell wearing it does NOT re-hint: the cell's box
  // is mid-glide under the pointer while its props already hold the
  // final-layout index, so re-hinting bounces the preview straight
  // back — a feedback loop at every cell boundary. Leave unset for
  // consumers that don't animate reorders.
  moveClass?: string
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

  // Single write path for the hint. Dragover fires continuously
  // (~10/s) while the pointer moves; writing a fresh object per event
  // made the live-preview watcher rebuild + re-render the whole grid
  // every tick, restarting the in-flight reflow animations — the drag
  // read as stutter. Only a genuinely NEW target touches the ref.
  function setHint(row: number, idx: number) {
    const cur = dropHint.value
    if (cur && cur.row === row && cur.idx === idx) return
    dropHint.value = { row, idx }
  }

  // True when the event's cell is still settling from a previous
  // preview reflow (see UseDragReorderOptions.moveClass).
  function cellIsSettling(e: DragEvent): boolean {
    if (!opts.moveClass) return false
    const el = e.currentTarget
    return el instanceof Element && el.classList.contains(opts.moveClass)
  }

  function onDragOver(row: number, idx: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault() // permit drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    if (cellIsSettling(e)) return
    setHint(row, idx)
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
    opts.onMove(id, { row: fromRow, idx: fromIdx }, { row, idx: toIdx })
    onDragEnd()
  }

  // "Append at the row tail" is only a real target when the pointer
  // sits past the row's last cell — right of it on its own line, or
  // below it. Everywhere else the container only hears dragover
  // because the pointer is crossing the grid GAPS between cells;
  // treating those as "append" bounced the live preview to the tail
  // and back on every gap crossing. Gaps are transitional — keep the
  // current hint.
  function pointerPastLastCell(container: Element, x: number, y: number): boolean {
    const last = container.lastElementChild
    if (!last) return true // empty row: the whole container is the drop zone
    const rect = last.getBoundingClientRect()
    return y > rect.bottom || (y >= rect.top && x > rect.right)
  }

  function onRowDragOver(row: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    // Only consider the "append at end" hint when the event ORIGINATED
    // on the row container, not when it bubbled up from a child cell.
    // Without this guard, the per-cell dropHint set a moment earlier
    // gets clobbered on the bubble pass and the live-preview lands
    // every drag at the row tail.
    if (e.target !== e.currentTarget) return
    const container = e.currentTarget instanceof Element ? e.currentTarget : null
    if (container && !pointerPastLastCell(container, e.clientX, e.clientY)) return
    setHint(row, opts.rowSize(row))
  }

  function onRowDrop(row: number, e: DragEvent) {
    if (!dragging.value) return
    e.preventDefault()
    const { id, row: fromRow, idx: fromIdx } = dragging.value
    // Releasing over a gap must land the widget where the hint (and
    // the live preview) showed it — not at the row tail. Same
    // source-before-target compensation as onDrop. No hint → the
    // legacy append contract.
    const hint = dropHint.value
    const toRow = hint ? hint.row : row
    let toIdx = hint ? hint.idx : opts.rowSize(row)
    if (hint && fromRow === toRow && fromIdx < toIdx) toIdx -= 1
    // Fire onMove BEFORE onDragEnd — see onDrop's note for why.
    opts.onMove(id, { row: fromRow, idx: fromIdx }, { row: toRow, idx: toIdx })
    onDragEnd()
  }

  function onHandleKeydown(id: string, row: number, idx: number, e: KeyboardEvent) {
    let handled = true
    switch (e.key) {
      case 'ArrowLeft': {
        if (idx === 0) { handled = false; break }
        opts.onMove(id, { row, idx }, { row, idx: idx - 1 })
        break
      }
      case 'ArrowRight': {
        const lastIdx = Math.max(0, opts.rowSize(row) - 1)
        if (idx >= lastIdx) { handled = false; break }
        opts.onMove(id, { row, idx }, { row, idx: idx + 1 })
        break
      }
      case 'ArrowUp': {
        const upRow = adjacentRow(row, -1)
        if (upRow === null) { handled = false; break }
        const clampedIdx = Math.min(idx, opts.rowSize(upRow))
        opts.onMove(id, { row, idx }, { row: upRow, idx: clampedIdx })
        break
      }
      case 'ArrowDown': {
        const downRow = adjacentRow(row, 1)
        if (downRow === null) { handled = false; break }
        const clampedIdx = Math.min(idx, opts.rowSize(downRow))
        opts.onMove(id, { row, idx }, { row: downRow, idx: clampedIdx })
        break
      }
      case 'Home': {
        if (idx === 0) { handled = false; break }
        opts.onMove(id, { row, idx }, { row, idx: 0 })
        break
      }
      case 'End': {
        const lastIdx = Math.max(0, opts.rowSize(row) - 1)
        if (idx >= lastIdx) { handled = false; break }
        opts.onMove(id, { row, idx }, { row, idx: lastIdx })
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

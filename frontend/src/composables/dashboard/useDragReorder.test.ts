import { describe, it, expect, vi } from 'vitest'
import { useDragReorder } from '@/composables/dashboard/useDragReorder'

// Fake DragEvent that captures preventDefault calls.
function fakeDragEvent(overrides: Partial<DragEvent> = {}): DragEvent {
  const e = {
    preventDefault: vi.fn(),
    dataTransfer: {
      effectAllowed: '',
      dropEffect: '',
      setData: vi.fn(),
    } as unknown as DataTransfer,
    ...overrides,
  } as unknown as DragEvent
  return e
}

function fakeKeyEvent(key: string): KeyboardEvent {
  return {
    key,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent
}

describe('useDragReorder — drag handlers', () => {
  it('onDragStart captures dragging coords', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    expect(api.dragging.value).toEqual({ id: 'winrate', row: 1, idx: 0 })
  })

  it('onDragEnd clears the state', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onDragEnd()
    expect(api.dragging.value).toBeNull()
    expect(api.dropHint.value).toBeNull()
  })

  it('onDragOver sets the drop hint and prevents default', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    const evt = fakeDragEvent()
    api.onDragOver(1, 2, evt)
    expect(evt.preventDefault).toHaveBeenCalled()
    expect(api.dropHint.value).toEqual({ row: 1, idx: 2 })
  })

  it('onDrop fires onMove with (id, fromRow, fromIdx, toRow, toIdx)', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onDrop(2, 1, fakeDragEvent())
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 0, 2, 1)
  })

  it('onDrop fires onMove BEFORE clearing dragging state (live-preview consumers depend on this)', () => {
    let snapshot: { id: string; row: number; idx: number } | null = null
    const onMove = vi.fn(function captureDragging() {
      // Read api.dragging.value inside onMove — should still hold
      // the source coords. If onDragEnd had fired first, this would
      // be null.
      snapshot = api.dragging.value
    })
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onDrop(2, 1, fakeDragEvent())
    expect(snapshot).toEqual({ id: 'winrate', row: 1, idx: 0 })
    // And the state is cleared by the time onDrop returns.
    expect(api.dragging.value).toBeNull()
  })

  it('onRowDrop also fires onMove before clearing dragging state', () => {
    let snapshot: { id: string; row: number; idx: number } | null = null
    const onMove = vi.fn(function captureDragging() {
      snapshot = api.dragging.value
    })
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onRowDrop(2, fakeDragEvent())
    expect(snapshot).toEqual({ id: 'winrate', row: 1, idx: 0 })
    expect(api.dragging.value).toBeNull()
  })

  it('onDrop on the same coords is a no-op', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onDrop(1, 0, fakeDragEvent())
    expect(onMove).not.toHaveBeenCalled()
  })

  it('onDrop same-row source-before-target compensates the target idx', () => {
    // The drag contract: "drop on cell at original idx X" = "land
    // in front of that cell". After splicing the source out, the
    // visual target idx shifts down by 1 → toIdx = idx - 1 for the
    // post-removal insertion.
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 5 })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onDrop(1, 3, fakeDragEvent())
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 0, 1, 2)
  })

  it('onDrop same-row source-after-target passes idx through unchanged', () => {
    // Source is past the target → removing source doesn't shift
    // the target's post-removal idx. Pass the visual idx straight
    // through.
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 5 })
    api.onDragStart('winrate', 1, 4, fakeDragEvent())
    api.onDrop(1, 1, fakeDragEvent())
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 4, 1, 1)
  })

  it('onDrop without a prior drag is ignored', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: () => 4 })
    api.onDrop(1, 0, fakeDragEvent())
    expect(onMove).not.toHaveBeenCalled()
  })

  it('onRowDrop appends to the row past the last cell', () => {
    const onMove = vi.fn()
    const api = useDragReorder({ onMove, rowSize: (row) => (row === 2 ? 3 : 5) })
    api.onDragStart('winrate', 1, 0, fakeDragEvent())
    api.onRowDrop(2, fakeDragEvent())
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 0, 2, 3)
  })
})

describe('useDragReorder — keyboard alternatives', () => {
  function setup(rowSizes: Record<number, number>) {
    const onMove = vi.fn()
    const api = useDragReorder({
      onMove,
      rowSize: (row) => rowSizes[row] ?? 0,
    })
    return { api, onMove }
  }

  it('ArrowLeft moves to idx-1 within the same row', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 2, fakeKeyEvent('ArrowLeft'))
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 2, 1, 1)
  })

  it('ArrowLeft at idx 0 is a no-op', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 0, fakeKeyEvent('ArrowLeft'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ArrowRight moves to idx+1 within the same row', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 2, fakeKeyEvent('ArrowRight'))
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 2, 1, 3)
  })

  it('ArrowRight at the last idx is a no-op', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 4, fakeKeyEvent('ArrowRight'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('ArrowDown moves to the same idx in the next row, clamped', () => {
    const { api, onMove } = setup({ 1: 5, 2: 3 })
    api.onHandleKeydown('winrate', 1, 4, fakeKeyEvent('ArrowDown'))
    // Target row only has 3 cells (idx 0..2); clamp to length 3 → idx 3 (append at end).
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 4, 2, 3)
  })

  it('ArrowUp moves to the same idx in the previous row, clamped', () => {
    const { api, onMove } = setup({ 1: 5, 2: 3 })
    api.onHandleKeydown('top-maps', 2, 1, fakeKeyEvent('ArrowUp'))
    expect(onMove).toHaveBeenCalledWith('top-maps', 2, 1, 1, 1)
  })

  it('Home jumps to idx 0', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 3, fakeKeyEvent('Home'))
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 3, 1, 0)
  })

  it('End jumps to the row\'s last idx', () => {
    const { api, onMove } = setup({ 1: 5 })
    api.onHandleKeydown('winrate', 1, 1, fakeKeyEvent('End'))
    expect(onMove).toHaveBeenCalledWith('winrate', 1, 1, 1, 4)
  })

  it('ArrowUp at row 1 with a null adjacentRow resolver is a no-op', () => {
    const onMove = vi.fn()
    const api = useDragReorder({
      onMove,
      rowSize: () => 5,
      adjacentRow: (from, dir) => (dir === -1 ? null : from + 1),
    })
    api.onHandleKeydown('winrate', 1, 0, fakeKeyEvent('ArrowUp'))
    expect(onMove).not.toHaveBeenCalled()
  })

  it('Unknown key is ignored without preventDefault', () => {
    const { api, onMove } = setup({ 1: 5 })
    const ev = fakeKeyEvent('q')
    api.onHandleKeydown('winrate', 1, 0, ev)
    expect(onMove).not.toHaveBeenCalled()
    expect(ev.preventDefault).not.toHaveBeenCalled()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import UnknownBulkBar from '@/components/unknown/UnknownBulkBar.vue'
import { useUnknownSelection, type UnknownSelectableRow } from '@/composables/unknown/useUnknownSelection'
import { setWritesLocked, resetWriteGate, STUB_LOCK_REASON } from '@/test-utils/writeGateStub'

vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

const ROWS: UnknownSelectableRow[] = [
  { id: 'a', files: ['a.png'] },
  { id: 'b', files: ['b1.png', 'b2.png'] },
]

function renderBar(opts: {
  rows?: UnknownSelectableRow[]
  tick?: string[]
  rowNoun?: 'card' | 'screenshot'
} = {}) {
  const rows = opts.rows ?? ROWS
  const onDismissFiles = vi.fn()
  const selection = useUnknownSelection({ rows: () => rows, onDismissFiles })
  for (const id of opts.tick ?? []) selection.setSelected(id, true)
  const view = render(UnknownBulkBar, {
    props: {
      selection,
      rowNoun: opts.rowNoun ?? 'card',
      selectAllLabel: 'Select all unmatched',
      regionLabel: 'Unmatched screenshots bulk actions',
      totalRows: rows.length,
    },
  })
  return { ...view, selection, onDismissFiles }
}

describe('UnknownBulkBar', () => {
  beforeEach(() => { resetWriteGate() })
  afterEach(() => { resetWriteGate() })

  it('stays out of the way until something is ticked', () => {
    renderBar()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('names the rows ticked and the screenshots they carry, which differ', () => {
    // Dismissing is card-whole, so two ticked cards can suppress three files.
    // A bar that named only one of those numbers would understate the cost.
    renderBar({ tick: ['a', 'b'] })
    expect(screen.getByRole('button', { name: 'Dismiss 2 cards (3 screenshots)' })).toBeInTheDocument()
  })

  it('says it once for a section whose rows are one screenshot each', () => {
    renderBar({ rowNoun: 'screenshot', rows: [{ id: 'x', files: ['x.png'] }], tick: ['x'] })
    expect(screen.getByRole('button', { name: 'Dismiss 1 screenshot' })).toBeInTheDocument()
  })

  it('counts one card in the singular', () => {
    renderBar({ tick: ['a'] })
    expect(screen.getByRole('button', { name: 'Dismiss 1 card (1 screenshot)' })).toBeInTheDocument()
  })

  it('arms before it fires, and fires nothing on the first press', async () => {
    const { onDismissFiles } = renderBar({ tick: ['a'] })
    await fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
    expect(screen.getByRole('button', { name: 'Confirm dismissing 1 card (1 screenshot)?' })).toBeInTheDocument()
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('dismisses every file behind the ticked rows on the second press', async () => {
    const { onDismissFiles } = renderBar({ tick: ['a', 'b'] })
    await fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
    await fireEvent.click(screen.getByRole('button', { name: /^Confirm dismissing/ }))
    expect(onDismissFiles).toHaveBeenCalledWith(['a.png', 'b1.png', 'b2.png'])
  })

  it('offers a way out of an armed confirm', async () => {
    const { onDismissFiles } = renderBar({ tick: ['a'] })
    await fireEvent.click(screen.getByRole('button', { name: /^Dismiss/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: /^Dismiss 1 card/ })).toBeInTheDocument()
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('hides its own select-all once everything is ticked', () => {
    renderBar({ tick: ['a', 'b'] })
    expect(screen.queryByRole('button', { name: 'Select all unmatched' })).not.toBeInTheDocument()
  })

  it('names the section on select-all, since three of these can share a screen', () => {
    renderBar({ tick: ['a'] })
    expect(screen.getByRole('button', { name: 'Select all unmatched' })).toBeInTheDocument()
  })

  it('lets the selection go without dismissing anything', async () => {
    const { onDismissFiles, selection } = renderBar({ tick: ['a'] })
    await fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(selection.selectedCount.value).toBe(0)
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('refuses the dismiss while writes are locked, and says why', () => {
    // Defense in depth: the Unknown tab renders nothing during a coaching
    // session, so this is unreachable through the UI — but a disabled button
    // that explains itself is the contract every writer here keeps.
    setWritesLocked(true, { session: true })
    renderBar({ tick: ['a'] })
    const dismiss = screen.getByRole('button', { name: /^Dismiss/ })
    expect(dismiss).toBeDisabled()
    expect(dismiss).toHaveAttribute('title', STUB_LOCK_REASON)
  })

  it('still lets a locked user clear a selection they already made', () => {
    setWritesLocked(true, { session: true })
    renderBar({ tick: ['a'] })
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled()
  })

  it('is a landmark named for the section it acts on', () => {
    // Its own prop, not one derived by string-stripping the select-all label:
    // that produced lowercase fragments and would have renamed the landmark
    // whenever anyone reworded a button.
    renderBar({ tick: ['a'] })
    expect(screen.getByRole('region', { name: 'Unmatched screenshots bulk actions' })).toBeInTheDocument()
  })

  it('follows a selection that changes after it is on screen', async () => {
    // Every other case here ticks before render, so a snapshot-instead-of-ref
    // refactor would leave them all green.
    const { selection } = renderBar()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
    selection.setSelected('a', true)
    await nextTick()
    expect(screen.getByRole('button', { name: 'Dismiss 1 card (1 screenshot)' })).toBeInTheDocument()
    selection.setSelected('b', true)
    await nextTick()
    expect(screen.getByRole('button', { name: 'Dismiss 2 cards (3 screenshots)' })).toBeInTheDocument()
  })

  it('collapses when the last ticked row is unticked after mount', async () => {
    const { selection } = renderBar({ tick: ['a'] })
    expect(screen.getByRole('region')).toBeInTheDocument()
    selection.setSelected('a', false)
    await nextTick()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})

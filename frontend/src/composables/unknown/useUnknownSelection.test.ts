import { describe, it, expect, vi, afterEach } from 'vitest'
import { nextTick, ref } from 'vue'
import { useUnknownSelection, type UnknownSelectableRow } from '@/composables/unknown/useUnknownSelection'

const ROWS: UnknownSelectableRow[] = [
  { id: 'a', files: ['a.png'] },
  { id: 'b', files: ['b1.png', 'b2.png'] },
  { id: 'c', files: ['c.png'] },
]

function setup(initial: UnknownSelectableRow[] = ROWS) {
  const rows = ref(initial)
  const onDismissFiles = vi.fn()
  const sel = useUnknownSelection({ rows: () => rows.value, onDismissFiles })
  return { sel, rows, onDismissFiles }
}

describe('useUnknownSelection', () => {
  afterEach(() => { vi.useRealTimers() })

  it('starts empty', () => {
    const { sel } = setup()
    expect(sel.selectedCount.value).toBe(0)
    expect(sel.selectedFiles.value).toEqual([])
  })

  it('counts rows and the screenshots behind them separately', () => {
    // A card is dismissed whole, so two ticked cards can be three files —
    // and the bar has to be able to say both numbers.
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.toggleSelected('b')
    expect(sel.selectedCount.value).toBe(2)
    expect(sel.selectedFiles.value).toEqual(['a.png', 'b1.png', 'b2.png'])
  })

  it('toggles a row back off', () => {
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.toggleSelected('a')
    expect(sel.selectedCount.value).toBe(0)
  })

  it('selects every row currently in the section', () => {
    const { sel } = setup()
    sel.selectAll()
    expect(sel.selectedCount.value).toBe(3)
    expect(sel.selectedFiles.value).toHaveLength(4)
  })

  it('ignores a ticked row that has since disappeared', () => {
    // A parse run can retire a row while it is ticked. A stale id must not
    // inflate the count the confirm is about, nor resurrect a dismissed file.
    const { sel, rows } = setup()
    sel.selectAll()
    rows.value = [{ id: 'a', files: ['a.png'] }]
    expect(sel.selectedCount.value).toBe(1)
    expect(sel.selectedFiles.value).toEqual(['a.png'])
  })

  it('dismisses every file behind the ticked rows, once each', () => {
    const { sel, onDismissFiles } = setup()
    sel.toggleSelected('a')
    sel.toggleSelected('b')
    sel.requestDismiss()
    sel.commitDismiss()
    expect(onDismissFiles).toHaveBeenCalledWith(['a.png', 'b1.png', 'b2.png'])
  })

  it('clears the selection as it commits, so the bar collapses', () => {
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    sel.commitDismiss()
    expect(sel.selectedCount.value).toBe(0)
    expect(sel.armed.value).toBe(false)
  })

  it('arms before it fires', () => {
    const { sel, onDismissFiles } = setup()
    sel.toggleSelected('a')
    expect(sel.armed.value).toBe(false)
    sel.requestDismiss()
    expect(sel.armed.value).toBe(true)
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('disarms when the selection changes underneath it', () => {
    // The armed confirm was about a different set of files.
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    sel.toggleSelected('c')
    expect(sel.armed.value).toBe(false)
  })

  it('disarms on select-all and on clear', () => {
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    sel.selectAll()
    expect(sel.armed.value).toBe(false)
    sel.requestDismiss()
    sel.clearSelection()
    expect(sel.armed.value).toBe(false)
  })

  it('refuses to arm or fire on an empty selection', () => {
    const { sel, onDismissFiles } = setup()
    sel.requestDismiss()
    expect(sel.armed.value).toBe(false)
    sel.commitDismiss()
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('refuses to fire when every ticked row vanished before the confirm', () => {
    const { sel, rows, onDismissFiles } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    rows.value = []
    sel.commitDismiss()
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('cancels an armed confirm without firing', () => {
    const { sel, onDismissFiles } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    sel.cancelDismiss()
    expect(sel.armed.value).toBe(false)
    expect(onDismissFiles).not.toHaveBeenCalled()
    expect(sel.selectedCount.value).toBe(1)
  })

  it('reports whether a given row is ticked', () => {
    const { sel } = setup()
    sel.setSelected('a', true)
    expect(sel.isSelected('a')).toBe(true)
    sel.setSelected('a', false)
    expect(sel.isSelected('a')).toBe(false)
  })

  it('never lists one screenshot twice', () => {
    const { sel } = setup([
      { id: 'x', files: ['shared.png'] },
      { id: 'y', files: ['shared.png', 'own.png'] },
    ])
    sel.selectAll()
    expect(sel.selectedFiles.value).toEqual(['shared.png', 'own.png'])
  })

  it('disarms when a parse run grows the file set under a ticked row', () => {
    // The confirm is about a FILE SET, and the ids are only half of what
    // decides it: a SUMMARY screenshot merging into a ticked match under the
    // same key would otherwise add a file to a confirm already on screen.
    const { sel, rows } = setup([{ id: 'k', files: ['a.png'] }])
    sel.toggleSelected('k')
    sel.requestDismiss()
    expect(sel.armed.value).toBe(true)
    rows.value = [{ id: 'k', files: ['a.png', 'brand-new.png'] }]
    return nextTick().then(() => {
      expect(sel.armed.value).toBe(false)
    })
  })

  it('disarms when a ticked row loses a file', () => {
    const { sel, rows } = setup([{ id: 'k', files: ['a.png', 'b.png'] }])
    sel.toggleSelected('k')
    sel.requestDismiss()
    rows.value = [{ id: 'k', files: ['a.png'] }]
    return nextTick().then(() => {
      expect(sel.armed.value).toBe(false)
    })
  })

  it('stays armed while nothing about the file set moved', () => {
    const { sel, rows } = setup([{ id: 'k', files: ['a.png'] }, { id: 'other', files: ['z.png'] }])
    sel.toggleSelected('k')
    sel.requestDismiss()
    // A change to a row nobody ticked is not a change to the confirm.
    rows.value = [{ id: 'k', files: ['a.png'] }, { id: 'other', files: ['z.png', 'z2.png'] }]
    return nextTick().then(() => {
      expect(sel.armed.value).toBe(true)
    })
  })

  it('auto-disarms after the shared window, like the per-card button', () => {
    vi.useFakeTimers()
    const { sel, onDismissFiles } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    expect(sel.armed.value).toBe(true)
    vi.advanceTimersByTime(3100)
    expect(sel.armed.value).toBe(false)
    expect(onDismissFiles).not.toHaveBeenCalled()
  })

  it('keeps the selection when the confirm times out', () => {
    // Disarming is not cancelling: the ticks are still the user's.
    vi.useFakeTimers()
    const { sel } = setup()
    sel.toggleSelected('a')
    sel.requestDismiss()
    vi.advanceTimersByTime(3100)
    expect(sel.selectedCount.value).toBe(1)
  })

  it('refuses to tick a row carrying no files', () => {
    // The per-card path hides its button outright for these; counting one
    // would arm a confirm over a card that then quietly survives the sweep.
    const { sel } = setup([{ id: 'empty', files: [] }])
    sel.setSelected('empty', true)
    expect(sel.selectedCount.value).toBe(0)
    expect(sel.isSelected('empty')).toBe(false)
  })

  it('skips file-less rows on select-all', () => {
    const { sel } = setup([{ id: 'a', files: ['a.png'] }, { id: 'empty', files: [] }])
    sel.selectAll()
    expect(sel.selectedCount.value).toBe(1)
    expect(sel.selectedFiles.value).toEqual(['a.png'])
  })
})

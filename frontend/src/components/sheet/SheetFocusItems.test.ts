import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import type { FocusItem } from '@/api-client'
import SheetFocusItems from '@/components/sheet/SheetFocusItems.vue'

const THREE: FocusItem[] = [
  { item_id: 'a', text: 'hold the angle' },
  { item_id: 'b', text: 'ult economy' },
  { item_id: 'c', text: 'call the dive' },
]

function renderList(items: FocusItem[] = THREE, props: Record<string, unknown> = {}) {
  return render(SheetFocusItems, { props: { id: 'focus', items, ...props } })
}

function lastUpdate(view: ReturnType<typeof renderList>): FocusItem[] {
  const updates = view.emitted<[FocusItem[]]>('update')
  expect(updates, 'an update was emitted').toBeTruthy()
  return updates![updates!.length - 1]![0]
}

const row = (n: number) => screen.getByRole('textbox', { name: `What to work on, item ${n}` })

describe('SheetFocusItems', () => {
  it('is a row per item, in the order it was handed', () => {
    renderList()
    expect(screen.getAllByRole('listitem')).toHaveLength(3)
    expect(row(1)).toHaveValue('hold the angle')
    expect(row(3)).toHaveValue('call the dive')
  })

  it('reports a row edit without touching the others', async () => {
    const view = renderList()
    await fireEvent.update(row(2), 'ult tracking')
    expect(lastUpdate(view)).toEqual([
      THREE[0], { item_id: 'b', text: 'ult tracking' }, THREE[2],
    ])
  })

  it('grows a row from the button', async () => {
    const view = renderList()
    await fireEvent.click(screen.getByRole('button', { name: '+ Add an item' }))
    const next = lastUpdate(view)
    expect(next).toHaveLength(4)
    expect(next[3]!.text).toBe('')
  })

  // Enter opens the next row and Backspace on an empty one closes it: the
  // two things every list editor does, so a whole list can be typed without
  // reaching for the mouse.
  it('opens the next row on Enter, right below the one you were in', async () => {
    const view = renderList()
    await fireEvent.keyDown(row(1), { key: 'Enter' })
    const next = lastUpdate(view)
    expect(next).toHaveLength(4)
    expect(next[1]!.text).toBe('')
    expect(next[2]).toEqual(THREE[1])
  })

  it('closes an empty row on Backspace', async () => {
    const view = renderList([THREE[0]!, { item_id: 'b', text: '' }])
    await fireEvent.keyDown(row(2), { key: 'Backspace' })
    expect(lastUpdate(view)).toEqual([THREE[0]])
  })

  it('leaves the last row alone on Backspace, so the editor never empties itself', async () => {
    const view = renderList([{ item_id: 'a', text: '' }])
    await fireEvent.keyDown(row(1), { key: 'Backspace' })
    expect(view.emitted('update')).toBeUndefined()
  })

  it('leaves a row with words in it alone on Backspace', async () => {
    const view = renderList()
    await fireEvent.keyDown(row(1), { key: 'Backspace' })
    expect(view.emitted('update')).toBeUndefined()
  })

  it('reorders a row and clamps at both ends', async () => {
    const view = renderList()
    await fireEvent.click(screen.getByRole('button', { name: 'Move item 3 up' }))
    expect(lastUpdate(view).map((i) => i.item_id)).toEqual(['a', 'c', 'b'])
    expect(screen.getByRole('button', { name: 'Move item 1 up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move item 3 down' })).toBeDisabled()
  })

  it('drops a row', async () => {
    const view = renderList()
    await fireEvent.click(screen.getByRole('button', { name: 'Remove item 2' }))
    expect(lastUpdate(view).map((i) => i.item_id)).toEqual(['a', 'c'])
  })

  it('refuses every edit while the list cannot be saved, and says why', async () => {
    const view = renderList(THREE, { blockedReason: 'A coaching session is open.' })
    expect(row(1)).toBeDisabled()
    expect(screen.getByRole('button', { name: '+ Add an item' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove item 1' })).toBeDisabled()

    await fireEvent.keyDown(row(1), { key: 'Enter' })
    expect(view.emitted('update')).toBeUndefined()
    expect(screen.getByRole('status', { name: 'Focus list save state' }))
      .toHaveTextContent('A coaching session is open.')
  })

  it('caps a row at what the server accepts', () => {
    renderList()
    expect(row(1)).toHaveAttribute('maxlength', '2000')
  })
})

describe('SheetFocusItems — the typing itself', () => {
  it('asks to be underlined, not corrected', () => {
    renderList()
    expect(row(1)).toHaveAttribute('spellcheck', 'true')
    expect(row(1)).toHaveAttribute('autocorrect', 'off')
  })
})

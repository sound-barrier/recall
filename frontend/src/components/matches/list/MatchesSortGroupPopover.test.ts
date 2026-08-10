import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchesSortGroupPopover from '@/components/matches/list/MatchesSortGroupPopover.vue'

// The leaves-head Sort + Group menu: two radio groups in one anchored dialog.
// What can break here is the wiring, not the paint — a pick that closes the
// menu instead of leaving it open, a Group fieldset that stays live in Data
// density, a click-outside listener that survives unmount. Placement is
// exercised in sort-group-popover-position.test.ts.

const ANCHOR = { top: 200, bottom: 224, left: 320 } as DOMRect

// Mirrors the SFC's own unions — a shared type can't cross the .vue boundary
// (see frontend/CLAUDE.md), and the completeness of GroupBy is pinned by the
// menu-order test below.
type SortOrder = 'newest' | 'oldest'
type GroupBy = 'none' | 'day' | 'week' | 'month' | 'year' | 'session' | 'provenance'

function renderPopover(props: Partial<{ open: boolean; sort: SortOrder; group: GroupBy; groupingDisabled: boolean }> = {}) {
  return render(MatchesSortGroupPopover, {
    props: { open: true, sort: 'newest', group: 'day', anchor: ANCHOR, ...props },
  })
}

const radio = (name: string) => screen.getByRole('radio', { name })

describe('MatchesSortGroupPopover', () => {
  it('renders nothing until open', () => {
    renderPopover({ open: false })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens as a named dialog with both axes offered in menu order', () => {
    renderPopover()
    expect(screen.getByRole('dialog', { name: 'Sort and group the matches list' })).toBeInTheDocument()
    expect(screen.getAllByRole('radio').map((r) => r.getAttribute('name'))).toEqual([
      'sort', 'sort', 'group', 'group', 'group', 'group', 'group', 'group', 'group',
    ])
    expect(screen.getByRole('group', { name: 'Sort' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Group' })).toBeInTheDocument()
  })

  it('checks exactly the option each prop names', () => {
    renderPopover({ sort: 'oldest', group: 'week' })
    expect(screen.getAllByRole('radio').filter((r) => (r as HTMLInputElement).checked)
      .map((r) => r.getAttribute('value'))).toEqual(['oldest', 'week'])
  })

  it('a pick reports the new axis and leaves the menu open', async () => {
    const { emitted } = renderPopover()
    await fireEvent.click(radio('Oldest first'))
    expect(emitted('update:sort')).toEqual([['oldest']])

    await fireEvent.click(radio('By month'))
    expect(emitted('update:group')).toEqual([['month']])

    // The list re-renders underneath; dismissal stays the parent's call.
    expect(emitted('close')).toBeUndefined()
    expect(screen.getByRole('dialog', { name: 'Sort and group the matches list' })).toBeInTheDocument()
  })

  it('greys out the whole Group axis in Data density, keeping Sort live', async () => {
    const user = userEvent.setup()
    const { emitted } = renderPopover({ groupingDisabled: true })
    expect(screen.getByText('Data view sorts by column header')).toBeInTheDocument()
    for (const name of ['No grouping', 'By day', 'By week', 'By month', 'By year', 'By session', 'By provenance']) {
      expect(radio(name)).toBeDisabled()
    }
    // Driven through user-event, which honors `disabled` the way a browser
    // does — fireEvent would dispatch straight past it.
    await user.click(radio('By week'))
    expect(emitted('update:group')).toBeUndefined()

    expect(radio('Oldest first')).toBeEnabled()
    await user.click(radio('Oldest first'))
    expect(emitted('update:sort')).toEqual([['oldest']])
  })

  it('offers no disabled-grouping hint while grouping is live', () => {
    renderPopover()
    expect(screen.queryByText('Data view sorts by column header')).not.toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const { emitted } = renderPopover()
    await fireEvent.keyDown(document, { key: 'Escape' })
    expect(emitted('close')).toHaveLength(1)
  })

  it('closes on a click outside, but not on one inside it or on its own trigger', async () => {
    const trigger = document.createElement('button')
    trigger.setAttribute('data-sort-group-trigger', '')
    document.body.appendChild(trigger)
    const { emitted } = renderPopover()

    await fireEvent.pointerDown(screen.getByRole('dialog'))
    await fireEvent.pointerDown(trigger)
    expect(emitted('close')).toBeUndefined()

    await fireEvent.pointerDown(document.body)
    expect(emitted('close')).toHaveLength(1)
    trigger.remove()
  })

  it('stays silent on outside clicks while it is closed', async () => {
    // The document listener lives for the component's whole life, not just
    // the open window — without the open guard every stray click in the
    // workspace would ask the parent to close an already-closed menu.
    const { emitted } = renderPopover({ open: false })
    await fireEvent.pointerDown(document.body)
    expect(emitted('close')).toBeUndefined()
  })
})

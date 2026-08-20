import { render, screen, fireEvent, within } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import type { FocusItem } from '@/api-client'
import CoachSessionSheet from '@/components/coach/notes/CoachSessionSheet.vue'

const BASE = {
  player: { handle: 'Sable', message: 'Mostly worried about my ult timing on control.' },
  wld: { w: 4, l: 3, d: 1 },
  winRate: 57,
  focusTally: [{ tag: 'ult_economy', count: 3 }, { tag: 'tempo', count: 1 }],
  notesLine: '7 notes · 1 reviewed only · Ordo',
  focusItems: [{ item_id: 'f-1', text: 'Ult economy first.' }],
  canExport: true,
}

function renderSheet(props: Record<string, unknown> = {}) {
  return render(CoachSessionSheet, { props: { ...BASE, ...props } })
}

describe('CoachSessionSheet', () => {
  it('names the player being reviewed and repeats what they asked for', () => {
    renderSheet()
    expect(screen.getByRole('heading', { name: 'Reviewing Sable' })).toBeInTheDocument()
    expect(screen.getByText(/worried about my ult timing/)).toBeInTheDocument()
  })

  it("leaves the message out when the bundle carried none", () => {
    renderSheet({ player: { handle: 'Wren' } })
    expect(screen.getByRole('heading', { name: 'Reviewing Wren' })).toBeInTheDocument()
    expect(screen.queryByText(/worried about/)).not.toBeInTheDocument()
  })

  it("tallies the session's record and win rate", () => {
    renderSheet()
    const record = within(screen.getByRole('group', { name: 'Session record' }))
    expect(record.getByText('4')).toBeInTheDocument()
    expect(record.getByText('3')).toBeInTheDocument()
    expect(record.getByText('1')).toBeInTheDocument()
    expect(record.getByText('57%')).toBeInTheDocument()
  })

  it('reads as no-sample rather than 0% when nothing was decisive', () => {
    renderSheet({ winRate: null })
    expect(within(screen.getByRole('group', { name: 'Session record' })).getByText('—')).toBeInTheDocument()
  })

  it('lists what the coach has been focusing on, in human words', () => {
    renderSheet()
    const tally = within(screen.getByRole('list', { name: /focus/i }))
    const rows = tally.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('ult economy')
    expect(rows[0]).toHaveTextContent('3')
  })

  it('counts the notes written so far', () => {
    renderSheet()
    expect(screen.getByText('7 notes · 1 reviewed only · Ordo')).toBeInTheDocument()
  })

  it('carries the focus list and reports what the coach writes', async () => {
    const view = renderSheet()
    const first = screen.getByRole('textbox', { name: 'What to work on, item 1' })
    expect(first).toHaveValue('Ult economy first.')
    await fireEvent.update(first, 'Ult economy first, then positioning')
    expect(view.emitted('update-focus-items')?.at(-1)).toEqual([
      [{ item_id: 'f-1', text: 'Ult economy first, then positioning' }],
    ])
  })

  it('grows a row and drops one, so a list is typed rather than punctuated', async () => {
    const view = renderSheet()
    await fireEvent.click(screen.getByRole('button', { name: '+ Add an item' }))
    expect(view.emitted<[FocusItem[]]>('update-focus-items')?.at(-1)?.[0]).toHaveLength(2)

    await fireEvent.click(screen.getByRole('button', { name: 'Remove item 1' }))
    expect(view.emitted('update-focus-items')?.at(-1)).toEqual([[]])
  })

  it('says the player\'s data is never kept', () => {
    renderSheet()
    expect(screen.getByText(/These matches are on loan — nothing here joins your history/)).toBeInTheDocument()
  })

  it('exports and ends the session through its own affordances', async () => {
    const view = renderSheet()
    await fireEvent.click(screen.getByRole('button', { name: '1 · Export notes' }))
    await fireEvent.click(screen.getByRole('button', { name: '2 · End session' }))
    expect(view.emitted('export')).toHaveLength(1)
    expect(view.emitted('end')).toHaveLength(1)
  })

  it('disables Export with the reason it cannot run yet', () => {
    renderSheet({ canExport: false, exportReason: 'Set a coach name in Settings first.' })
    const button = screen.getByRole('button', { name: '1 · Export notes' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Set a coach name in Settings first.')
  })
})

import { render, screen, fireEvent, within } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'

import CoachSessionSheet from '@/components/coach/notes/CoachSessionSheet.vue'

const BASE = {
  player: { handle: 'Sable', message: 'Mostly worried about my ult timing on control.' },
  wld: { w: 4, l: 3, d: 1 },
  winRate: 57,
  focusTally: [{ tag: 'ult_economy', count: 3 }, { tag: 'tempo', count: 1 }],
  notesLine: '7 notes · 1 reviewed only · Ordo',
  summary: 'Ult economy first.',
  canExport: true,
}

function renderSheet(props: Record<string, unknown> = {}) {
  return render(CoachSessionSheet, { props: { ...BASE, ...props } })
}

describe('CoachSessionSheet', () => {
  it('names the player being reviewed and repeats what she asked for', () => {
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

  it('carries the session summary and reports what the coach writes', async () => {
    const view = renderSheet()
    const summary = screen.getByRole('textbox', { name: /What to work on/ })
    expect(summary).toHaveValue('Ult economy first.')
    await fireEvent.update(summary, 'Ult economy first. Then positioning on control.')
    expect(view.emitted('update-summary')).toEqual([['Ult economy first. Then positioning on control.']])
  })

  it('says the player\'s data is never kept', () => {
    renderSheet()
    expect(screen.getByText(/Nothing here is saved to your profile/)).toBeInTheDocument()
  })

  it('exports and ends the session through its own affordances', async () => {
    const view = renderSheet()
    await fireEvent.click(screen.getByRole('button', { name: 'Export notes' }))
    await fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(view.emitted('export')).toHaveLength(1)
    expect(view.emitted('end')).toHaveLength(1)
  })

  it('disables Export with the reason it cannot run yet', () => {
    renderSheet({ canExport: false, exportReason: 'Set a coach name in Settings first.' })
    const button = screen.getByRole('button', { name: 'Export notes' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', 'Set a coach name in Settings first.')
  })
})

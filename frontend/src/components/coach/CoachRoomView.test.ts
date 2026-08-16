import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect } from 'vitest'
import { h } from 'vue'

import type { MatchRecord, MatchResult } from '@/api-client'
import CoachRoomView from '@/components/coach/CoachRoomView.vue'
import { emptyDraft } from '@/match/coach-notes'

function rec(key: string, data: MatchResult): MatchRecord {
  return { match_key: key, source_files: [], data }
}

const LATE = rec('match-2026-08-08T22-30-00', { date: '2026-08-08', finished_at: '22:30', result: 'defeat', map: 'numbani', hero: 'kiriko' })
const EARLY = rec('match-2026-08-08T21-14-00', { date: '2026-08-08', finished_at: '21:14', result: 'victory', map: "king's row", hero: 'ana' })

const PLAYER = { handle: 'Sable', message: 'Watch my ult timing on control.' }

function renderRoom(props: Record<string, unknown> = {}, options: Record<string, unknown> = {}) {
  return render(CoachRoomView, {
    props: { player: PLAYER, records: [EARLY, LATE], notes: {}, selectedKey: '', summary: '', coachName: 'Ordo', ...props },
    ...options,
  })
}

describe('CoachRoomView — the three regions', () => {
  it('is the coach panel the app shell addresses', () => {
    const view = renderRoom()
    // eslint-disable-next-line testing-library/no-node-access, testing-library/no-container -- #panel-coach is the room's panel id; the app shell and the e2e both address it, and no TL query expresses an id
    expect(view.container.querySelector('#panel-coach')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Film room' })).toBeInTheDocument()
  })

  it('lays out the reel, the desk and the session sheet', () => {
    renderRoom()
    expect(screen.getByRole('list', { name: /Sable.s matches/ })).toBeInTheDocument()
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reviewing Sable' })).toBeInTheDocument()
  })

  it('puts the newest frame on the desk until the coach picks one', () => {
    renderRoom()
    expect(screen.getByRole('heading', { name: 'Numbani' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Numbani/ })).toHaveAttribute('aria-current', 'true')
  })

  it('shows the frame the coach picked', () => {
    renderRoom({ selectedKey: EARLY.match_key })
    expect(screen.getByRole('heading', { name: "King's Row" })).toBeInTheDocument()
  })

  it('tells the sheet how the session is going', () => {
    renderRoom({ notes: { [EARLY.match_key]: { ...emptyDraft(), text: 'Peel earlier.' } } })
    expect(screen.getByText('1 note · Ordo')).toBeInTheDocument()
  })
})

describe('CoachRoomView — what it reports upward', () => {
  it('reports the frame the coach clicked', async () => {
    const view = renderRoom()
    await fireEvent.click(screen.getByRole('button', { name: /King's Row/ }))
    expect(view.emitted('select')).toEqual([[EARLY.match_key]])
  })

  it('walks the reel with the bracket keys', () => {
    const view = renderRoom()
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }))
    expect(view.emitted('select')).toEqual([[EARLY.match_key]])
  })

  it('steps with the desk buttons too', async () => {
    const view = renderRoom({ selectedKey: EARLY.match_key })
    await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(view.emitted('select')).toEqual([[LATE.match_key]])
  })

  it("reports a note edit against the frame it was written on", async () => {
    const view = renderRoom({ selectedKey: EARLY.match_key })
    await fireEvent.click(screen.getByRole('button', { name: 'positioning' }))
    expect(view.emitted('update-note')).toEqual([[EARLY.match_key, { ...emptyDraft(), focusTags: ['positioning'] }]])
  })

  it('reports the session summary', async () => {
    const view = renderRoom()
    await fireEvent.update(screen.getByRole('textbox', { name: /What to work on/ }), 'Ult economy first.')
    expect(view.emitted('update-summary')).toEqual([['Ult economy first.']])
  })

  it('relays export and end', async () => {
    const view = renderRoom()
    await fireEvent.click(screen.getByRole('button', { name: 'Export notes' }))
    await fireEvent.click(screen.getByRole('button', { name: 'End session' }))
    expect(view.emitted('export')).toHaveLength(1)
    expect(view.emitted('end')).toHaveLength(1)
  })
})

describe('CoachRoomView — an empty bundle', () => {
  it('keeps its three regions with nothing to review', () => {
    renderRoom({ records: [] })
    expect(screen.getByText(/carries no matches/)).toBeInTheDocument()
    expect(screen.getByText(/Pick a frame/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Reviewing Sable' })).toBeInTheDocument()
  })
})

describe('CoachRoomView — the region slots', () => {
  it('lets a caller supply its own sheet', () => {
    renderRoom({}, { slots: { sheet: () => h('p', 'a borrowed sheet') } })
    expect(screen.getByText('a borrowed sheet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Reviewing Sable' })).not.toBeInTheDocument()
    expect(screen.getByRole('article')).toBeInTheDocument()
  })
})

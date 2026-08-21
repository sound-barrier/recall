import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect, vi } from 'vitest'
import { h } from 'vue'

import type { FocusItem, MatchRecord, MatchResult } from '@/api-client'
import CoachRoomView from '@/components/coach/room/CoachRoomView.vue'
import type { CoachSaveState, RoomApi } from '@/components/coach/room/coach-room-props'
import type { CoachMoment } from '@/match/coach/coach-moments'
import { emptyDraft, type CoachNoteDraft } from '@/match/coach/coach-notes'
import { markdownField } from '@/test-utils'

function rec(key: string, data: MatchResult): MatchRecord {
  return { match_key: key, source_files: [], data }
}

const LATE = rec('match-2026-08-08T22-30-00', { date: '2026-08-08', finished_at: '22:30', result: 'defeat', map: 'numbani', hero: 'kiriko' })
const EARLY = rec('match-2026-08-08T21-14-00', { date: '2026-08-08', finished_at: '21:14', result: 'victory', map: "king's row", hero: 'ana' })

const PLAYER = { handle: 'Sable', message: 'Watch my ult timing on control.' }

// The room takes its corpus as one RoomApi bundle, so the harness builds one.
// Overrides name a single member — `renderRoom({ selectedKey: k })` — because
// a test that had to restate all ten to change one would stop saying which one
// it cared about.
type ApiOver = Partial<{
  records: MatchRecord[]
  notes: Record<string, CoachNoteDraft>
  moments: Record<string, CoachMoment[]>
  selectedKey: string
  focusItems: FocusItem[]
  saveStateFor: (key: string) => CoachSaveState
}>

function roomApi(over: ApiOver = {}, spies: Partial<RoomApi> = {}): RoomApi {
  return {
    records: () => over.records ?? [EARLY, LATE],
    notes: () => over.notes ?? {},
    moments: () => over.moments ?? {},
    selectedKey: () => over.selectedKey ?? '',
    focusItems: () => over.focusItems ?? [{ item_id: 'f-1', text: '' }],
    saveStateFor: over.saveStateFor ?? (() => 'idle'),
    selectKey: () => {},
    updateNote: () => {},
    updateMoment: () => {},
    removeMoment: () => {},
    ...spies,
  }
}

function renderRoom(
  over: ApiOver & { api?: RoomApi } & Record<string, unknown> = {},
  options: Record<string, unknown> = {},
) {
  const { records, notes, moments, selectedKey, focusItems, saveStateFor, api, ...rest } = over
  return render(CoachRoomView, {
    props: {
      player: PLAYER,
      coachName: 'Ordo',
      api: api ?? roomApi({ records, notes, moments, selectedKey, focusItems, saveStateFor }),
      ...rest,
    },
    ...options,
  })
}

describe('CoachRoomView — the three regions', () => {
  // A region inside the Reviews tabpanel, not a panel of its own: the tab is
  // the panel, and goToView focuses #panel-<view>.
  it('is the film-room region the Reviews tab hosts', () => {
    const view = renderRoom()
    // eslint-disable-next-line testing-library/no-node-access -- #film-room is the room's element id; the e2e addresses it, and no TL query expresses an id
    expect(view.container.querySelector('#film-room')).toBeInTheDocument()
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

// The four writers reach the store through the RoomApi bundle rather than an
// emit the parent re-wires, so these assert the call the room actually makes.
// Closer to the truth than the old emit assertions were: an emitted event only
// became a store write if some parent remembered to bind it, and both parents
// bound all four identically.
describe('CoachRoomView — what it writes back', () => {
  it('selects the frame the coach clicked', async () => {
    const selectKey = vi.fn()
    renderRoom({ api: roomApi({}, { selectKey }) })
    await fireEvent.click(screen.getByRole('button', { name: /King's Row/ }))
    expect(selectKey).toHaveBeenCalledWith(EARLY.match_key)
  })

  it('walks the reel with the bracket keys', () => {
    const selectKey = vi.fn()
    renderRoom({ api: roomApi({}, { selectKey }) })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: ']', bubbles: true, cancelable: true }))
    expect(selectKey).toHaveBeenCalledWith(EARLY.match_key)
  })

  it('steps with the desk buttons too', async () => {
    const selectKey = vi.fn()
    renderRoom({ api: roomApi({ selectedKey: EARLY.match_key }, { selectKey }) })
    await fireEvent.click(screen.getByRole('button', { name: 'Previous match' }))
    expect(selectKey).toHaveBeenCalledWith(LATE.match_key)
  })

  it('writes a note edit against the frame it was written on', async () => {
    const updateNote = vi.fn()
    renderRoom({ api: roomApi({ selectedKey: EARLY.match_key }, { updateNote }) })
    await fireEvent.click(screen.getByRole('button', { name: 'positioning' }))
    expect(updateNote).toHaveBeenCalledWith(
      EARLY.match_key, { ...emptyDraft(), focusTags: ['positioning'] })
  })
})

describe('CoachRoomView — what it still reports upward', () => {

  it('reports the focus list', async () => {
    const view = renderRoom()
    await fireEvent.update(
      screen.getByRole('textbox', { name: 'What to work on, item 1' }), 'Ult economy first.')
    expect(view.emitted('update-focus-items')).toEqual([
      [[{ item_id: 'f-1', text: 'Ult economy first.' }]],
    ])
  })

  it('relays export and end', async () => {
    const view = renderRoom()
    await fireEvent.click(screen.getByRole('button', { name: '1 · Export notes' }))
    await fireEvent.click(screen.getByRole('button', { name: '2 · End session' }))
    expect(view.emitted('export')).toHaveLength(1)
    expect(view.emitted('end')).toHaveLength(1)
  })
})

describe('CoachRoomView — an empty bundle', () => {
  // The desk's two empties are not the same, and this case used to assert the
  // wrong one: "Pick a frame from the reel" pointed the coach at an EMPTY reel
  // and asked them to choose from it.
  it('keeps its three regions, and says why there is nothing to pick', () => {
    renderRoom({ records: [] })
    expect(screen.getByText(/carries no matches/)).toBeInTheDocument()
    expect(screen.getByText(/holds no matches to review/)).toBeInTheDocument()
    expect(screen.queryByText(/Pick a frame/)).not.toBeInTheDocument()
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

// "Bundle suggests, coach confirms" — and a bundle that suggested nothing
// leaves the room with a blank name where every note PUT answers 409. The
// room has to ASK, and it has to let a suggested handle be corrected.
describe('CoachRoomView — who is this?', () => {
  const ANONYMOUS = { handle: '' }
  const handleField = () => screen.getByRole('textbox', { name: 'Player handle' })

  it('asks who the bundle is about when it named nobody', () => {
    renderRoom({ player: ANONYMOUS })
    expect(screen.getByRole('heading', { name: 'Who is this?' })).toBeInTheDocument()
    expect(handleField()).toBeInTheDocument()
  })

  it('reports the handle the coach confirms', async () => {
    const view = renderRoom({ player: ANONYMOUS })
    await fireEvent.update(handleField(), 'Wren')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(view.emitted('confirm-player')).toEqual([['Wren']])
  })

  it('will not take a note that has nowhere to be saved', async () => {
    renderRoom({ player: ANONYMOUS })
    expect(await markdownField()).toBeDisabled()
    expect(screen.getByRole('status', { name: 'Note save state' }))
      .toHaveTextContent(/before writing notes/)
  })

  // The note editor was blocked but the sheet's list was not, so a coach
  // could type "what to work on" against a bundle naming nobody, have every
  // PUT refused unseen, and lose the words when they answered the prompt.
  it('will not take a focus list that has nowhere to be saved either', () => {
    renderRoom({ player: ANONYMOUS })
    expect(screen.getByRole('textbox', { name: 'What to work on, item 1' })).toBeDisabled()
  })

  it('lets the coach correct a handle the bundle suggested', async () => {
    const view = renderRoom()
    expect(screen.queryByRole('textbox', { name: 'Player handle' })).not.toBeInTheDocument()

    await fireEvent.click(screen.getByRole('button', { name: /Change player/ }))
    expect(handleField()).toHaveDisplayValue('Sable')
    await fireEvent.update(handleField(), 'Wren')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(view.emitted('confirm-player')).toEqual([['Wren']])
  })

  it('keeps the editor writable while a confirmed handle is corrected', async () => {
    renderRoom()
    await fireEvent.click(screen.getByRole('button', { name: /Change player/ }))
    // markdownField, not the formatted div: toBeEnabled passes vacuously on a
    // contenteditable, so this assertion would keep passing while meaning
    // nothing at all.
    expect(await markdownField()).toBeEnabled()
  })

  it('shows the save state of the frame on the desk', () => {
    renderRoom({ saveStateFor: (key: string) => (key === LATE.match_key ? 'saving' : 'idle') })
    expect(screen.getByRole('status', { name: 'Note save state' })).toHaveTextContent('Saving')
  })
})

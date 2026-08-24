import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { CoachReturnItem, CoachReturnSheet as Sheet } from '@/api-client'
import CoachReturnSheet from '@/components/coach/inbox/CoachReturnSheet.vue'
import { qk } from '@/queries/keys'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The decision surface. Every verdict is local until the player commits,
// and BOTH commit paths ("Decide later" and "Finish") write the same
// partial map — the difference is what the player means, not what is saved.

const MATCH_A = 'match-2026-08-13T22-30-00'
const MATCH_B = 'match-2026-08-13T21-14-00'

function note(noteId: string, over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: noteId,
    match_key: MATCH_A,
    kind: 'note' as const,
    text: `note ${noteId}`,
    focus_tags: ['positioning'],
    extra_tags: [],
    match_clock: '06:40',
    updated_at: '2026-08-14T19:02:00Z',
    status: 'pending' as const,
    match: { map: 'numbani', hero: 'ana', result: 'victory', date: '2026-08-13', finished_at: '22:30' },
    ...over,
  }
}

function sheet(over: Partial<Sheet> = {}): Sheet {
  return {
    id: 7,
    coach_name: 'Ordo',
    player_handle: 'Sable',
    session_date: '2026-08-14',
    imported_at: '2026-08-15T09:12:00Z',
    focus_items: [{ item_id: 'f-1', text: 'Ult economy first, positioning second.' }],
    notes: [note('n-1'), note('n-2', { match_key: MATCH_B })],
    decisions: {},
    pending: 2,
    player_mismatch: false,
    ...over,
  }
}

function open(staged: Sheet = sheet()) {
  seedQuery(qk.coach.returns, [staged])
  setActivePinia(createPinia())
  const store = useCoachReturnsStore()
  const decide = vi.spyOn(store, 'decide').mockResolvedValue(undefined)
  store.stageImportedNotes(staged)
  const utils = render(CoachReturnSheet)
  return { store, decide, ...utils }
}

const dialog = () => screen.getByRole('dialog', { name: /Notes from Ordo/ })
const cards = () => within(dialog()).getAllByRole('radiogroup')

describe('CoachReturnSheet', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('renders nothing until a sheet is staged', () => {
    seedQuery(qk.coach.returns, [])
    setActivePinia(createPinia())
    render(CoachReturnSheet)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('names the coach and shows one verdict group per note', () => {
    open()
    expect(dialog()).toBeInTheDocument()
    expect(cards()).toHaveLength(2)
    expect(within(dialog()).getByText('note n-1')).toBeInTheDocument()
    expect(within(dialog()).getByText('Ult economy first, positioning second.')).toBeInTheDocument()
  })

  it('records one verdict per note and counts what Finish would save', async () => {
    const user = userEvent.setup()
    open()
    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Accept' }))
    await user.click(within(cards()[1]!).getByRole('radio', { name: 'Skip' }))
    expect(within(cards()[0]!).getByRole('radio', { name: 'Accept' })).toBeChecked()
    expect(within(dialog()).getByRole('button', { name: /^Finish · 1 accepted/ })).toBeInTheDocument()
  })

  it('Accept all sweeps every note; Skip all takes them back', async () => {
    const user = userEvent.setup()
    open()
    await user.click(within(dialog()).getByRole('button', { name: 'Accept all notes' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · 2 accepted/ })).toBeInTheDocument()
    await user.click(within(dialog()).getByRole('button', { name: 'Skip all notes' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · 0 accepted/ })).toBeInTheDocument()
  })

  it('Finish writes the decided notes and closes', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Accept' }))
    // One note is still undecided, so Finish ARMS first — the banner would
    // keep nagging about it — and "Finish anyway" is the informed commit.
    await user.click(within(dialog()).getByRole('button', { name: /^Finish/ }))
    expect(within(dialog()).getByText(/1 note is still undecided/)).toBeInTheDocument()
    expect(decide).not.toHaveBeenCalled()
    await user.click(within(dialog()).getByRole('button', { name: 'Finish anyway' }))
    expect(decide).toHaveBeenCalledWith(7, { 'n-1': 'accepted' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  // A failed PUT used to close the dialog anyway, throwing away every
  // verdict the player had just recorded — the one state where the work is
  // gone AND the banner still nags. The store rejects; the CALLER decides,
  // and the only safe decision is to hold the sheet open.
  it('keeps the sheet open and every verdict when the save fails', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    decide.mockRejectedValue(new Error('server said no'))
    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Accept' }))
    await user.click(within(cards()[1]!).getByRole('radio', { name: 'Skip' }))
    await user.click(within(dialog()).getByRole('button', { name: /^Finish/ }))

    expect(decide).toHaveBeenCalledWith(7, { 'n-1': 'accepted', 'n-2': 'skipped' })
    expect(dialog()).toBeInTheDocument()
    expect(within(dialog()).getByRole('alert')).toHaveTextContent(/could not be saved/i)
    expect(within(cards()[0]!).getByRole('radio', { name: 'Accept' })).toBeChecked()
    expect(within(cards()[1]!).getByRole('radio', { name: 'Skip' })).toBeChecked()
  })

  it('clears the failure notice once a retry lands', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    decide.mockRejectedValueOnce(new Error('server said no'))
    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Accept' }))
    await user.click(within(dialog()).getByRole('button', { name: /^Finish/ }))
    await user.click(within(dialog()).getByRole('button', { name: 'Finish anyway' }))
    expect(within(dialog()).getByRole('alert')).toBeInTheDocument()

    await user.click(within(dialog()).getByRole('button', { name: /^Finish/ }))
    await user.click(within(dialog()).getByRole('button', { name: 'Finish anyway' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('"Decide later" saves the partial map — undecided notes are omitted', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    await user.click(within(cards()[1]!).getByRole('radio', { name: 'Skip' }))
    await user.click(within(dialog()).getByRole('button', { name: 'Decide later' }))
    expect(decide).toHaveBeenCalledWith(7, { 'n-2': 'skipped' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closing an untouched sheet writes nothing', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    await user.click(within(dialog()).getByRole('button', { name: 'Decide later' }))
    expect(decide).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('reopens with the decisions already recorded', () => {
    open(sheet({ decisions: { 'n-1': 'accepted', 'n-2': 'skipped' } }))
    expect(within(cards()[0]!).getByRole('radio', { name: 'Accept' })).toBeChecked()
    expect(within(cards()[1]!).getByRole('radio', { name: 'Skip' })).toBeChecked()
    expect(within(dialog()).getByRole('button', { name: /^Finish · 1 accepted/ })).toBeInTheDocument()
  })

  // A second session re-sends notes the player already accepted. The server
  // knows (a block with that note_id sits on the match); the player cannot,
  // unless the card says so — otherwise five taken notes and two new ones
  // look identical and re-deciding them re-runs their effect.
  it('marks the notes the player already accepted, so the new ones stand out', () => {
    open(sheet({
      notes: [
        note('n-old', { status: 'accepted' }),
        note('n-new', { match_key: MATCH_B }),
      ],
    }))

    const already = screen.getByRole('article', { name: /already accepted/i })
    expect(within(already).getByText(/note n-old/)).toBeInTheDocument()
    expect(screen.queryByRole('article', { name: /already accepted/i })).not.toContainElement(
      screen.getByText(/note n-new/),
    )
  })

  it('an orphan can be skipped but never accepted, and says why', async () => {
    const user = userEvent.setup()
    open(sheet({ notes: [note('n-1', { status: 'orphan' })] }))
    const accept = within(cards()[0]!).getByRole('radio', { name: 'Accept' })
    expect(accept).toBeDisabled()
    expect(within(dialog()).getByText(/isn't in your history any more/)).toBeInTheDocument()

    await user.click(within(dialog()).getByRole('button', { name: 'Accept all notes' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · 0 accepted/ })).toBeInTheDocument()

    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Skip' }))
    expect(within(cards()[0]!).getByRole('radio', { name: 'Skip' })).toBeChecked()
  })

  it('warns when the archive was written about somebody else', () => {
    open(sheet({ player_mismatch: true, player_handle: 'Wren' }))
    expect(within(dialog()).getByText(/written about Wren/)).toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { CoachReturnItem, CoachReturnSheet as Sheet } from '@/api-client'
import CoachReturnSheet from '@/components/coach/CoachReturnSheet.vue'
import { qk } from '@/queries/keys'
import { useCoachStore } from '@/stores/coach'
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
    summary: 'Ult economy first, positioning second.',
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
  const store = useCoachStore()
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
    expect(within(dialog()).getByRole('button', { name: /^Finish · save 1 accepted/ })).toBeInTheDocument()
  })

  it('Accept all sweeps every note; Skip all takes them back', async () => {
    const user = userEvent.setup()
    open()
    await user.click(within(dialog()).getByRole('button', { name: 'Accept all' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · save 2 accepted/ })).toBeInTheDocument()
    await user.click(within(dialog()).getByRole('button', { name: 'Skip all' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · save 0 accepted/ })).toBeInTheDocument()
  })

  it('Finish writes the decided notes and closes', async () => {
    const user = userEvent.setup()
    const { decide } = open()
    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Accept' }))
    await user.click(within(dialog()).getByRole('button', { name: /^Finish/ }))
    expect(decide).toHaveBeenCalledWith(7, { 'n-1': 'accepted' })
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
    expect(within(dialog()).getByRole('button', { name: /^Finish · save 1 accepted/ })).toBeInTheDocument()
  })

  it('an orphan can be skipped but never accepted, and says why', async () => {
    const user = userEvent.setup()
    open(sheet({ notes: [note('n-1', { status: 'orphan' })] }))
    const accept = within(cards()[0]!).getByRole('radio', { name: 'Accept' })
    expect(accept).toBeDisabled()
    expect(within(dialog()).getByText(/isn't in your history any more/)).toBeInTheDocument()

    await user.click(within(dialog()).getByRole('button', { name: 'Accept all' }))
    expect(within(dialog()).getByRole('button', { name: /^Finish · save 0 accepted/ })).toBeInTheDocument()

    await user.click(within(cards()[0]!).getByRole('radio', { name: 'Skip' }))
    expect(within(cards()[0]!).getByRole('radio', { name: 'Skip' })).toBeChecked()
  })

  it('warns when the archive was written about somebody else', () => {
    open(sheet({ player_mismatch: true, player_handle: 'Wren' }))
    expect(within(dialog()).getByText(/written about Wren/)).toBeInTheDocument()
  })
})

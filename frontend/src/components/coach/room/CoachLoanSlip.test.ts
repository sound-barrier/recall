import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, within, fireEvent } from '@testing-library/vue'

import CoachLoanSlip from '@/components/coach/room/CoachLoanSlip.vue'
import { setApiBacking } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { useCoachStore } from '@/stores/coach'

// The slip takes the profile chip's place while a bundle is open: it is
// the answer to "whose data am I looking at", the reassurance that none of
// it is being kept, and the two lifecycle affordances (export, end).

const NOTED = 'match-2026-08-13T22-30-00'

function view(over: Record<string, unknown> = {}) {
  return {
    player: { id: 'sable-id', handle: 'Sable', message: '' },
    exported_at: '2026-08-14T18:30:00Z',
    session_date: '2026-08-15',
    match_count: 6,
    coach_name: 'Ordo',
    summary: '',
    notes: [],
    handle_from_bundle: true,
    ...over,
  }
}

const WRITTEN_NOTE = {
  note_id: 'n-1',
  match_key: NOTED,
  kind: 'note' as const,
  text: 'Late peel on B.',
  focus_tags: [],
  extra_tags: [],
  match_clock: '',
  updated_at: '2026-08-14T19:02:00Z',
}

beforeEach(() => {
  setActivePinia(createPinia())
  setApiBacking({
    ListCoachReturns: vi.fn(async () => []),
    GetCoachSessionMatches: vi.fn(async () => []),
    PutCoachNote: vi.fn(async () => undefined),
    ExportCoachNotes: vi.fn(async () => 'notes.zip'),
    CloseCoachSession: vi.fn(async () => undefined),
  })
})

// Seed the session BEFORE the store exists, the way production receives it
// — the store's observer then reads fresh data and never refetches.
function renderSlip(over: Record<string, unknown> = {}) {
  seedQuery(qk.coach.session, view(over))
  const coach = useCoachStore()
  const spies = {
    exportNotes: vi.spyOn(coach, 'exportNotes').mockResolvedValue(undefined),
    endSession: vi.spyOn(coach, 'endSession').mockResolvedValue(undefined),
  }
  return { coach, spies, view: render(CoachLoanSlip) }
}

const slip = () => screen.getByRole('region', { name: 'Coaching session: reviewing Sable' })

describe('CoachLoanSlip', () => {
  it('names the player, sizes the loan, and dates the bundle', () => {
    renderSlip()

    expect(slip()).toBeInTheDocument()
    expect(within(slip()).getByText('Sable')).toBeInTheDocument()
    expect(within(slip()).getByText(/6 matches · exported /)).toBeInTheDocument()
  })

  it('promises the coach nothing here is kept', () => {
    renderSlip()
    expect(within(slip()).getByText('Nothing here is saved to your profile.')).toBeInTheDocument()
  })

  it('counts the notes written so far', async () => {
    const { coach } = renderSlip({ notes: [WRITTEN_NOTE] })
    expect(within(slip()).getByText('Notes · 1')).toBeInTheDocument()

    coach.updateNote('match-2026-08-13T21-14-00', {
      kind: 'note', text: 'Ult later.', focusTags: [], extraTags: [], matchClock: '',
    })
    await Promise.resolve()

    expect(await within(slip()).findByText('Notes · 2')).toBeInTheDocument()
  })

  it('exports on demand', async () => {
    const { spies } = renderSlip()
    await fireEvent.click(within(slip()).getByRole('button', { name: 'Export notes' }))
    expect(spies.exportNotes).toHaveBeenCalled()
  })

  it('refuses to export without a coach name, and says why', () => {
    renderSlip({ coach_name: '' })
    const button = within(slip()).getByRole('button', { name: 'Export notes' })

    expect(button).toBeDisabled()
    expect(button.title).toMatch(/coach name/i)
  })

  it('ends a clean session on the first click', async () => {
    const { spies } = renderSlip()
    await fireEvent.click(within(slip()).getByRole('button', { name: 'End session' }))
    expect(spies.endSession).toHaveBeenCalled()
  })

  // Notes live on the server, but the ARCHIVE the player gets does not
  // exist until Export — so unexported work earns a second question.
  it('asks again when notes have been written but not exported', async () => {
    const { coach, spies } = renderSlip()
    coach.updateNote(NOTED, { kind: 'note', text: 'Peel earlier.', focusTags: [], extraTags: [], matchClock: '' })

    await fireEvent.click(within(slip()).getByRole('button', { name: 'End session' }))
    expect(spies.endSession).not.toHaveBeenCalled()

    const confirm = await within(slip()).findByRole('button', { name: /^End anyway/ })
    await fireEvent.click(confirm)
    expect(spies.endSession).toHaveBeenCalled()
  })
})

// A plain (not "share with a coach") export names nobody, so the slip has
// nothing to put where the handle goes until the room's prompt is answered.
describe('CoachLoanSlip — a bundle that named nobody', () => {
  const unnamedSlip = () =>
    screen.getByRole('region', { name: 'Coaching session: reviewing a player not yet named' })

  it('says so rather than showing a blank name', () => {
    renderSlip({ player: { id: '', handle: '', message: '' }, handle_from_bundle: false })
    expect(unnamedSlip()).toBeInTheDocument()
  })

  it('refuses to export an archive with nobody to address it to', () => {
    renderSlip({ player: { id: '', handle: '', message: '' }, handle_from_bundle: false })
    const button = within(unnamedSlip()).getByRole('button', { name: 'Export notes' })

    expect(button).toBeDisabled()
    expect(button.title).toMatch(/who this bundle is about/i)
  })
})

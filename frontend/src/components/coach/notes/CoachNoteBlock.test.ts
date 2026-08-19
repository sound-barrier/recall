import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { MatchCoachNote, MatchSelfReviewNote } from '@/api-client'
import CoachNoteBlock from '@/components/coach/notes/CoachNoteBlock.vue'
import { coachBlockView, selfBlockView } from '@/match/coach/note-block-view'
import { useSelfReviewStore } from '@/stores/selfReview'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { resetWriteGate, setWritesLocked, STUB_LOCK_REASON } from '@/test-utils/writeGateStub'

// Removing a block is a write, so the block asks the gate like every other
// writer; which lock is which is the gate's own test.
vi.mock('@/composables/shared/useWriteGate', async () => import('@/test-utils/writeGateStub'))

// The coach's block on a match: signed, dated, tagged, and removable. It
// is the RECEIVED layer — the player's own journal entry is a separate
// surface and this component never touches it.

const MATCH_KEY = 'match-2026-08-13T22-30-00'

function coachNote(over: Partial<MatchCoachNote> = {}): MatchCoachNote {
  return {
    id: 1,
    note_id: 'n-1',
    coach_name: 'Ordo',
    session_date: '2026-08-14',
    text: 'Late peel on B — hold high ground until the second bubble.',
    match_clock: '06:40',
    focus_tags: ['positioning', 'ult_economy'],
    extra_tags: ['tempo'],
    accepted_at: '2026-08-15T09:15:00Z',
    ...over,
  }
}

function renderBlock(note: MatchCoachNote = coachNote()) {
  setActivePinia(createPinia())
  const store = useCoachReturnsStore()
  const remove = vi.spyOn(store, 'removeCoachNote').mockResolvedValue(undefined)
  return { remove, ...render(CoachNoteBlock, { props: { matchKey: MATCH_KEY, block: coachBlockView(note) } }) }
}

const block = () => screen.getByRole('region', { name: "Coach's note from Ordo" })

describe('CoachNoteBlock', () => {
  beforeEach(() => { vi.clearAllMocks(); resetWriteGate() })

  it('is a named region carrying the note, the clock, the tags and the signature', () => {
    renderBlock()
    expect(block()).toBeInTheDocument()
    expect(screen.getByText(/Late peel on B/)).toBeInTheDocument()
    expect(screen.getByText('06:40')).toBeInTheDocument()
    expect(screen.getByText('positioning')).toBeInTheDocument()
    // The vocabulary tag reads in words, not in its wire spelling.
    expect(screen.getByText('ult economy')).toBeInTheDocument()
    expect(screen.getByText('tempo')).toBeInTheDocument()
    expect(screen.getByText(/Ordo · 2026-08-14/)).toBeInTheDocument()
  })

  it('says the match was reviewed by the coach', () => {
    renderBlock()
    expect(screen.getByText('Reviewed by coach')).toBeInTheDocument()
  })

  it('renders a reviewed-only mark, which carries no text', () => {
    renderBlock(coachNote({ text: '', match_clock: '', focus_tags: [], extra_tags: [] }))
    expect(screen.getByText('Reviewed — nothing to add.')).toBeInTheDocument()
  })

  it('"Remove this note" is armed: the first click asks with the cost, the second drops the block', async () => {
    const { remove } = renderBlock(coachNote({ id: 42 }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove this note' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Remove this note — moments go with it' }))
    expect(remove).toHaveBeenCalledWith(MATCH_KEY, 42)
  })

  it('"Keep it" disarms without removing', async () => {
    const { remove } = renderBlock(coachNote({ id: 42 }))
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove this note' }))
    await user.click(screen.getByRole('button', { name: 'Keep it' }))
    expect(remove).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeInTheDocument()
  })
})

// "Remove this note" was the one journal control with no gate: during a
// coaching session every sibling was disabled while this one stayed live,
// 409'd, and reported the refusal in a red banner from a control the gate
// had promised was off.
describe('CoachNoteBlock — the write gate', () => {
  beforeEach(() => { vi.clearAllMocks(); resetWriteGate() })

  it('disables Remove and titles it with the lock reason', () => {
    setWritesLocked(true, { session: true })
    renderBlock()
    const button = screen.getByRole('button', { name: 'Remove this note' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', STUB_LOCK_REASON)
  })

  it('refuses the write even when the click arrives anyway', async () => {
    setWritesLocked(true, { session: true })
    const { remove } = renderBlock()
    // dispatch rather than user-click: a disabled button swallows a real
    // click, so only this proves the GUARD refuses rather than the attribute.
    await fireEvent.click(screen.getByRole('button', { name: 'Remove this note' }))
    expect(remove).not.toHaveBeenCalled()
  })

  it('leaves Remove live when writes are open', () => {
    renderBlock()
    expect(screen.getByRole('button', { name: 'Remove this note' })).toBeEnabled()
  })
})

// The player's own sitting leaves a block of the same paper: named for the
// sitting, chipped with where the sitting stands, and removed through the
// sitting — not through the coach inbox.
describe('CoachNoteBlock — a block from your own review', () => {
  beforeEach(() => { vi.clearAllMocks(); resetWriteGate() })

  function renderSelfBlock(over: Partial<MatchSelfReviewNote> = {}) {
    setActivePinia(createPinia())
    const selfReview = useSelfReviewStore()
    const remove = vi.spyOn(selfReview, 'removeNoteFromSitting').mockResolvedValue(undefined)
    const note: MatchSelfReviewNote = {
      review_id: 'sitting-1', review_title: "Tuesday's Ana games", review_created_at: '2026-08-18T19:00:00Z',
      kind: 'note', text: 'Held the choke, then chased.', focus_tags: ['positioning'],
      moments: [{ moment_id: 'm-1', match_clock: '04:45', text: 'peeled late' }],
      updated_at: '2026-08-18T19:10:00Z', ...over,
    }
    return { remove, ...render(CoachNoteBlock, { props: { matchKey: MATCH_KEY, block: selfBlockView(note) } }) }
  }

  it('is named "Your review", signed with the sitting and its day, in progress until finished', () => {
    renderSelfBlock()
    expect(screen.getByRole('region', { name: 'Your review' })).toBeInTheDocument()
    expect(screen.getByText('In progress')).toBeInTheDocument()
    expect(screen.getByText(/Tuesday's Ana games ·/)).toBeInTheDocument()
    expect(screen.getByText('04:45')).toBeInTheDocument()
  })

  it('reads Finished once the sitting is', () => {
    renderSelfBlock({ review_finished_at: '2026-08-18T20:00:00Z' })
    expect(screen.getByText('Finished')).toBeInTheDocument()
  })

  it('"Remove from this review" is armed, and the second press drops the note through the sitting', async () => {
    const { remove } = renderSelfBlock()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Remove from this review' }))
    expect(remove).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Delete this note — moments go with it' }))
    expect(remove).toHaveBeenCalledWith('sitting-1', MATCH_KEY)
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { MatchCoachNote } from '@/api-client'
import CoachNoteBlock from '@/components/coach/CoachNoteBlock.vue'
import { useCoachStore } from '@/stores/coach'

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
  const store = useCoachStore()
  const remove = vi.spyOn(store, 'removeCoachNote').mockResolvedValue(undefined)
  return { remove, ...render(CoachNoteBlock, { props: { matchKey: MATCH_KEY, note } }) }
}

const block = () => screen.getByRole('region', { name: "Coach's note from Ordo" })

describe('CoachNoteBlock', () => {
  beforeEach(() => { vi.clearAllMocks() })

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

  it('"Remove this note" drops the block by its local row id', async () => {
    const { remove } = renderBlock(coachNote({ id: 42 }))
    await userEvent.setup().click(screen.getByRole('button', { name: 'Remove this note' }))
    expect(remove).toHaveBeenCalledWith(MATCH_KEY, 42)
  })
})

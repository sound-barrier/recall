import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import type { CoachReturnItem, CoachReturnSheet } from '@/api-client'
import CoachInboxBanner from '@/components/coach/CoachInboxBanner.vue'
import { qk } from '@/queries/keys'
import { useCoachStore } from '@/stores/coach'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The nag that outlives a reload. Its count comes from the SERVER's staged
// sheets, so "Decide later" leaves it up and finishing takes it down —
// there is no local dismissal to get out of sync.

function note(noteId: string, over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: noteId,
    match_key: 'match-2026-08-13T22-30-00',
    kind: 'note' as const,
    text: 'Late peel on B.',
    focus_tags: [],
    extra_tags: [],
    match_clock: '',
    updated_at: '2026-08-14T19:02:00Z',
    status: 'pending' as const,
    ...over,
  }
}

function sheet(over: Partial<CoachReturnSheet> = {}): CoachReturnSheet {
  return {
    id: 7,
    coach_name: 'Ordo',
    player_handle: 'Sable',
    session_date: '2026-08-14',
    imported_at: '2026-08-15T09:12:00Z',
    summary: '',
    notes: [note('n-1'), note('n-2')],
    decisions: {},
    pending: 2,
    player_mismatch: false,
    ...over,
  }
}

// Seed the inbox cache BEFORE the store exists so its observer starts fresh
// and never fires the fetch that would clobber the fixture.
function renderBanner(sheets: CoachReturnSheet[]) {
  seedQuery(qk.coach.returns, sheets)
  setActivePinia(createPinia())
  return render(CoachInboxBanner)
}

describe('CoachInboxBanner', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('names the coach and counts every undecided note', () => {
    renderBanner([sheet()])
    expect(screen.getByRole('status')).toHaveTextContent('2 notes from Ordo waiting')
  })

  it('says "note", singular, when one is left', () => {
    renderBanner([sheet({ decisions: { 'n-1': 'accepted' } })])
    expect(screen.getByRole('status')).toHaveTextContent('1 note from Ordo waiting')
  })

  it('an orphan never counts — it cannot be accepted', () => {
    renderBanner([sheet({ notes: [note('n-1'), note('n-2', { status: 'orphan' })] })])
    expect(screen.getByRole('status')).toHaveTextContent('1 note from Ordo waiting')
  })

  it('says nothing when every note is decided', () => {
    renderBanner([sheet({ decisions: { 'n-1': 'accepted', 'n-2': 'skipped' } })])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says nothing with an empty inbox', () => {
    renderBanner([])
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('Review opens the sheet that is still waiting', async () => {
    renderBanner([sheet({ id: 4, decisions: { 'n-1': 'accepted', 'n-2': 'skipped' } }), sheet({ id: 9 })])
    const open = vi.spyOn(useCoachStore(), 'openReturnSheet').mockResolvedValue(undefined)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Review' }))
    expect(open).toHaveBeenCalledWith(9)
  })
})

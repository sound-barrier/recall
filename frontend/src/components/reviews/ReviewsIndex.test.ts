import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { CoachReturnItem, CoachReturnSheet, MatchRecord } from '@/api-client'
import ReviewsIndex from '@/components/reviews/ReviewsIndex.vue'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The shelf's two data-bearing bands, driven from the stores it reads:
// notes waiting on a decision (the inbox), and reviews already received
// (coach blocks on the records). The pure grouping is pinned in
// reviews-helpers.test.ts; this pins what the shelf DOES with it.

function note(noteId: string, over: Partial<CoachReturnItem> = {}): CoachReturnItem {
  return {
    note_id: noteId, match_key: 'match-2026-08-13T22-30-00', kind: 'note' as const,
    text: 'Late peel on B.', focus_tags: [], extra_tags: [], match_clock: '',
    updated_at: '2026-08-14T19:02:00Z', status: 'pending' as const, ...over,
  }
}

function sheet(over: Partial<CoachReturnSheet> = {}): CoachReturnSheet {
  return {
    id: 7, coach_name: 'Ordo', player_handle: 'Sable', session_date: '2026-08-14',
    imported_at: '2026-08-15T09:12:00Z', summary: '', notes: [note('n-1'), note('n-2')],
    decisions: {}, pending: 2, player_mismatch: false, ...over,
  }
}

function rec(key: string, over: Partial<MatchRecord> = {}): MatchRecord {
  return {
    match_key: key, source_files: [], data: { map: 'rialto', date: key.slice(6, 16) }, ...over,
  } as MatchRecord
}

function coachBlock(id: string, coach: string, date: string) {
  return {
    id: 1, note_id: id, coach_name: coach, session_date: date, kind: 'note' as const,
    text: 'x', match_clock: '', focus_tags: [], extra_tags: [], moments: [],
    accepted_at: `${date}T09:00:00Z`, updated_at: `${date}T09:00:00Z`,
  }
}

// Seed the inbox cache BEFORE any store exists so its observer starts fresh.
function renderShelf(opts: { inbox?: CoachReturnSheet[]; records?: MatchRecord[] } = {}) {
  seedQuery(qk.coach.returns, opts.inbox ?? [])
  setActivePinia(createPinia())
  const matches = useMatchesStore()
  matches.records = opts.records ?? []
  return { view: render(ReviewsIndex), matches }
}

describe('ReviewsIndex — notes waiting on a decision', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists one row per sheet still holding an undecided note, and Review opens that sheet', async () => {
    renderShelf({
      inbox: [sheet(), sheet({ id: 8, coach_name: 'Vex', notes: [note('n-3')], pending: 1 }),
        sheet({ id: 9, coach_name: 'Kai', notes: [note('n-4', { status: 'accepted' })], pending: 0 })],
    })
    const returns = useCoachReturnsStore()
    const openSheet = vi.spyOn(returns, 'openReturnSheet').mockResolvedValue(undefined)

    const rows = within(screen.getByRole('list', { name: 'Notes waiting on a decision' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('2 notes from Ordo')
    expect(rows[1]).toHaveTextContent('1 note from Vex')

    await userEvent.setup().click(within(rows[1]!).getByRole('button', { name: 'Review' }))
    expect(openSheet).toHaveBeenCalledWith(8)
  })

  it('shows the empty sentence only when nothing is waiting AND nothing was received', () => {
    renderShelf()
    expect(screen.getByText(/No coach has looked yet/)).toBeInTheDocument()
    expect(screen.queryByRole('list', { name: 'Notes waiting on a decision' })).not.toBeInTheDocument()
  })
})

describe('ReviewsIndex — reviews received', () => {
  const RECORDS = [
    rec('match-2026-08-01T20-00-00', { coach_notes: [coachBlock('a', 'Ordo', '2026-08-15')] }),
    rec('match-2026-08-02T20-00-00', {
      coach_notes: [coachBlock('b', 'Ordo', '2026-08-15'), coachBlock('c', 'Ordo', '2026-08-15')],
    }),
  ]

  it('shows one paper card per sitting, named by its own heading', () => {
    renderShelf({ records: RECORDS })
    const shelf = screen.getByRole('list', { name: 'Reviews you have received' })
    const card = within(shelf).getByRole('article')
    // The article is labeled BY the heading (aria-labelledby), so the two
    // cannot disagree on plurals or counts.
    expect(card).toHaveAccessibleName(/Ordo · .*3 notes · 2 matches/)
    expect(screen.queryByText(/No coach has looked yet/)).not.toBeInTheDocument()
  })

  // The card takes you to the FIRST match the coach touched, in reading
  // order — through revealMatch, which widens the narrow for it if the
  // current narrow would hide it, rather than opening a panel over nothing.
  it('"Open the first match" lands on Matches and reveals the earliest noted match', async () => {
    const { matches } = renderShelf({ records: RECORDS })
    const app = useAppStore()
    const ui = useUiStore()
    await app.goToView('reviews')
    const reveal = vi.spyOn(ui, 'revealMatch')

    await userEvent.setup().click(screen.getByRole('button', { name: /Open the first match/ }))

    expect(app.view).toBe('matches')
    expect(reveal).toHaveBeenCalledWith('match-2026-08-01T20-00-00')
    expect(ui.selection.selectedKey.value).toBe('match-2026-08-01T20-00-00')
    expect(matches.matchesNarrow.anyNarrow.value).toBe(false)
  })

  it('prefers a member the current narrow already shows over the earliest', async () => {
    const { matches } = renderShelf({
      records: [
        RECORDS[0]!,
        rec('match-2026-08-02T20-00-00', {
          data: { map: 'ilios', date: '2026-08-02' },
          coach_notes: [coachBlock('b', 'Ordo', '2026-08-15')],
        }),
      ],
    })
    matches.matchesNarrow.pickedMaps.value = new Set(['ilios'])
    const ui = useUiStore()

    await userEvent.setup().click(screen.getByRole('button', { name: /Open the first match/ }))

    expect(ui.selection.selectedKey.value).toBe('match-2026-08-02T20-00-00')
    expect(matches.matchesNarrow.anyNarrow.value).toBe(true)
  })
})

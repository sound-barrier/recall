import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import type { CoachPlayerSummary, CoachReturnItem, CoachReturnSheet, MatchRecord, SelfReview, ShareExport } from '@/api-client'
import ReviewsIndex from '@/components/reviews/ReviewsIndex.vue'
import { qk } from '@/queries/keys'
import { useAppStore } from '@/stores/app'
import { useCoachReturnsStore } from '@/stores/coachReturns'
import { useMatchesStore } from '@/stores/matches'
import { useSelfReviewStore } from '@/stores/selfReview'
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
    imported_at: '2026-08-15T09:12:00Z', focus_items: [], notes: [note('n-1'), note('n-2')],
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
function renderShelf(opts: {
  inbox?: CoachReturnSheet[]
  records?: MatchRecord[]
  sittings?: SelfReview[]
  shares?: ShareExport[]
  roster?: CoachPlayerSummary[]
} = {}) {
  seedQuery(qk.coach.returns, opts.inbox ?? [])
  seedQuery(qk.selfReviews, opts.sittings ?? [])
  seedQuery(qk.shares, opts.shares ?? [])
  seedQuery(qk.coachPlayers, opts.roster ?? [])
  setActivePinia(createPinia())
  const matches = useMatchesStore()
  matches.records = opts.records ?? []
  return { view: render(ReviewsIndex), matches }
}

describe('ReviewsIndex — notes waiting on a decision', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('lists one row per sheet still holding an undecided note, and Read the notes opens that sheet', async () => {
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

    await userEvent.setup().click(within(rows[1]!).getByRole('button', { name: 'Read the notes' }))
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

  it('shows one paper card per sitting, titled by the coach, with the tallies as its label line', () => {
    renderShelf({ records: RECORDS })
    const shelf = screen.getByRole('list', { name: 'Reviews you have received' })
    const card = within(shelf).getByRole('article')
    // The article is labeled BY the coach heading; the counts are the line
    // under it, in visible text.
    expect(card).toHaveAccessibleName('Ordo')
    expect(card).toHaveTextContent(/3 notes · 2 matches/)
    expect(screen.queryByText(/No coach has looked yet/)).not.toBeInTheDocument()
  })

  // The card's door is the SET the review touched, worn as one visible,
  // clearable narrow clause — never a silent filter reset under a deep link.
  it('"Show these matches" narrows Matches to the review set as one labeled clause', async () => {
    const { matches } = renderShelf({ records: RECORDS })
    const app = useAppStore()
    await app.goToView('reviews')
    // A stale narrow is replaced, not merged: the click means "show me
    // exactly these".
    matches.matchesNarrow.pickedMaps.value = new Set(['ilios'])

    await userEvent.setup().click(screen.getByRole('button', { name: /Show these matches/ }))

    expect(app.view).toBe('matches')
    expect(matches.matchesNarrow.reviewSetFilter.value).toEqual({
      keys: new Set(['match-2026-08-01T20-00-00', 'match-2026-08-02T20-00-00']),
      label: 'notes from Ordo',
    })
    expect(matches.matchesNarrow.pickedMaps.value.size).toBe(0)
    expect(matches.matchesNarrow.anyNarrow.value).toBe(true)
  })
})

// Section 01: the shelf of the player's own sittings, newest first, each a
// card; Open and Delete go through the sitting store; empty is a sentence
// and a way to Matches.
describe('ReviewsIndex — your own reviews', () => {
  const SITTING: SelfReview = {
    review_id: 'r-1', title: "Tuesday's Ana games",
    focus_items: [{ item_id: 'f-1', text: 'Stop chasing flanks.' }],
    created_at: '2026-08-18T19:00:00Z', updated_at: '2026-08-18T19:00:00Z', finished_at: '2026-08-18T20:00:00Z',
    match_keys: ['match-2026-08-01T20-00-00'],
    notes: {
      'match-2026-08-01T20-00-00': { match_key: 'match-2026-08-01T20-00-00', kind: 'note', text: 'held', focus_tags: [], extra_tags: [], match_clock: '', created_at: '', updated_at: '' },
    },
  }

  it('lists each sitting as a card that opens and deletes through the store', async () => {
    renderShelf({ sittings: [SITTING], records: [rec('match-2026-08-01T20-00-00', { data: { result: 'victory' } } as Partial<MatchRecord>)] })
    const selfReview = useSelfReviewStore()
    const open = vi.spyOn(selfReview, 'openSitting').mockResolvedValue(undefined)
    const remove = vi.spyOn(selfReview, 'remove').mockResolvedValue(undefined)
    const shelf = screen.getByRole('list', { name: 'Your own reviews' })
    const card = within(shelf).getByRole('article', { name: "Tuesday's Ana games" })
    expect(card).toHaveAccessibleDescription(/1 match · 1 with notes · 1–0 · finished/)

    const user = userEvent.setup()
    await user.click(within(card).getByRole('button', { name: 'Open →' }))
    expect(open).toHaveBeenCalledWith('r-1')
    await user.click(within(card).getByRole('button', { name: 'Delete' }))
    await user.click(within(card).getByRole('button', { name: /^Delete this review/ }))
    expect(remove).toHaveBeenCalledWith('r-1')
    expect(screen.queryByText(/Nothing reviewed yet/)).not.toBeInTheDocument()
  })

  it('invites the first sitting when there is none, and Pick matches goes there with the hint raised', async () => {
    renderShelf()
    const app = useAppStore()
    const ui = useUiStore()
    expect(screen.getByText(/Nothing reviewed yet/)).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: /^Pick matches/ }))
    expect(app.view).toBe('matches')
    expect(ui.reviewPickHint).toBe(true)
  })

  it('starts a sitting over the last session or the last N, and says the counts', async () => {
    // Three matches: two in one evening (one session), one a week before.
    const records = [
      rec('match-2026-08-18T21-00-00', { data: { map: 'rialto', date: '2026-08-18', finished_at: '21:00' } }),
      rec('match-2026-08-18T21-40-00', { data: { map: 'ilios', date: '2026-08-18', finished_at: '21:40' } }),
      rec('match-2026-08-11T20-00-00', { data: { map: 'busan', date: '2026-08-11', finished_at: '20:00' } }),
    ]
    renderShelf({ records })
    const selfReview = useSelfReviewStore()
    const create = vi.spyOn(selfReview, 'createFromKeys').mockResolvedValue(undefined)

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Review my last session (2)' }))
    expect(create).toHaveBeenCalledWith(['match-2026-08-18T21-00-00', 'match-2026-08-18T21-40-00'])

    await user.click(screen.getByRole('button', { name: 'Review my last 3' }))
    expect(create).toHaveBeenLastCalledWith([
      'match-2026-08-18T21-40-00', 'match-2026-08-18T21-00-00', 'match-2026-08-11T20-00-00',
    ])
  })
})

// The sent ledger's receipt rows: newest first, counts spoken, and the
// "answered" pairing — by a staged sheet, by accepted blocks when the sheet
// was discarded, or not at all.
describe('ReviewsIndex — the sent ledger', () => {
  const SENT: ShareExport = {
    id: 1, handle: 'Me', message: '', exported_at: '2026-08-10T20:00:00Z',
    match_keys: ['match-2026-08-01T20-00-00'],
  }

  it('says nothing came back when nothing has', () => {
    renderShelf({ shares: [SENT] })
    const rows = within(screen.getByRole('list', { name: 'Matches you have sent out' })).getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent(/Sent 1 match ·/)
    expect(rows[0]).toHaveTextContent(/nothing back yet/)
  })

  it('pairs with the return sheet that answers it', () => {
    renderShelf({
      shares: [SENT],
      inbox: [sheet({ imported_at: '2026-08-14T09:00:00Z', notes: [note('n-1', { match_key: 'match-2026-08-01T20-00-00' })] })],
    })
    expect(screen.getByText(/answered by Ordo/)).toBeInTheDocument()
  })

  it('still says answered when the sheet was discarded but the blocks landed', () => {
    renderShelf({
      shares: [SENT],
      records: [rec('match-2026-08-01T20-00-00', { coach_notes: [coachBlock('a', 'Ordo', '2026-08-15')] })],
    })
    const sentRow = within(screen.getByRole('list', { name: 'Matches you have sent out' })).getAllByRole('listitem')[0]!
    expect(sentRow).toHaveTextContent(/answered by Ordo/)
  })

  it('a sheet imported BEFORE the share does not answer it', () => {
    renderShelf({
      shares: [{ ...SENT, exported_at: '2026-08-16T20:00:00Z' }],
      inbox: [sheet({ imported_at: '2026-08-14T09:00:00Z', notes: [note('n-1')] })],
    })
    expect(screen.getByText(/nothing back yet/)).toBeInTheDocument()
  })
})

// 03's roster: one quiet row per coached player, work counted, what they
// are working on printed when a list was written.
describe('ReviewsIndex — the coach roster', () => {
  it('lists players with counts, day, and focus list; pluralizes honestly', () => {
    renderShelf({
      roster: [
        { id: 2, handle: 'Sable', note_count: 12, last_note_at: '2026-08-14T20:00:00Z', focus_items: ['Ult economy first.'] },
        { id: 1, handle: 'Kestrel', note_count: 1 },
      ],
    })
    const rows = within(screen.getByRole('list', { name: 'Players you have coached' })).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent(/Sable · 12 notes · last session/)
    expect(rows[0]).toHaveTextContent(/Ult economy first/)
    expect(rows[1]).toHaveTextContent('Kestrel · 1 note')
    expect(screen.getByText(/Open their next bundle and the notes resurface/)).toBeInTheDocument()
  })
})

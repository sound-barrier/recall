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
    source: 'bundle' as const,
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
    expect(within(slip()).getByText(/6 matches · Sable exported /)).toBeInTheDocument()
  })

  it('promises the coach nothing here is kept', () => {
    renderSlip()
    expect(within(slip()).getByText('These matches are on loan — nothing here joins your history.')).toBeInTheDocument()
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
    await fireEvent.click(within(slip()).getByRole('button', { name: /^1 · Export notes file/ }))
    expect(spies.exportNotes).toHaveBeenCalled()
  })

  it('refuses to export without a coach name, and says why', () => {
    renderSlip({ coach_name: '' })
    const button = within(slip()).getByRole('button', { name: /^1 · Export notes file/ })

    expect(button).toBeDisabled()
    expect(button.title).toMatch(/coach name/i)
    // The reason in visible text too — a title reaches nobody on a keyboard.
    expect(within(slip()).getByText(/coach name/i)).toBeInTheDocument()
  })

  it('pairs the one-page copy with the notes file, behind the same gate', () => {
    renderSlip({ coach_name: '' })
    expect(within(slip()).getByRole('button', { name: /Save a web page/ })).toBeDisabled()
  })

  // A clean session ends without a second question — nothing is at stake, so
  // asking would be ceremony. Asserted by what stays on screen: the arming
  // lives in the store (both End buttons must ask the same thing), and the
  // store's own suite proves the request reaches the server.
  it('ends a clean session on the first click', async () => {
    renderSlip()
    await fireEvent.click(within(slip()).getByRole('button', { name: '2 · End session' }))

    expect(within(slip()).queryByRole('button', { name: /^End anyway/ })).not.toBeInTheDocument()
  })

  // Notes live on the server, but the ARCHIVE the player gets does not
  // exist until Export — so unexported work earns a second question. Asserted
  // through what the coach SEES rather than through a spy: the store owns the
  // arming, and the question is what the button says.
  it('asks again when notes have been written but not exported', async () => {
    const { coach } = renderSlip()
    coach.updateNote(NOTED, { kind: 'note', text: 'Peel earlier.', focusTags: [], extraTags: [], matchClock: '' })

    await fireEvent.click(within(slip()).getByRole('button', { name: '2 · End session' }))

    expect(await within(slip()).findByRole('button', { name: /^End anyway/ })).toBeInTheDocument()
  })

  // The armed state offers a way back. It used to replace the button in place
  // with no Cancel, so the only escape was to not click again.
  it('lets the coach back out of the question', async () => {
    const { coach } = renderSlip()
    coach.updateNote(NOTED, { kind: 'note', text: 'Peel earlier.', focusTags: [], extraTags: [], matchClock: '' })
    await fireEvent.click(within(slip()).getByRole('button', { name: '2 · End session' }))

    await fireEvent.click(within(slip()).getByRole('button', { name: 'Keep working' }))

    expect(within(slip()).queryByRole('button', { name: /^End anyway/ })).not.toBeInTheDocument()
    expect(within(slip()).getByRole('button', { name: '2 · End session' })).toBeInTheDocument()
  })
})

// A plain (not "share with a coach") export names nobody, so the slip has
// nothing to put where the handle goes until the room's prompt is answered.
describe('CoachLoanSlip — a bundle that named nobody', () => {
  const unnamedSlip = () =>
    screen.getByRole('region', { name: 'Coaching session: reviewing the player' })

  it('says so rather than showing a blank name', () => {
    renderSlip({ player: { id: '', handle: '', message: '' }, handle_from_bundle: false })
    expect(unnamedSlip()).toBeInTheDocument()
  })

  it('refuses to export an archive with nobody to address it to', () => {
    renderSlip({ player: { id: '', handle: '', message: '' }, handle_from_bundle: false })
    const button = within(unnamedSlip()).getByRole('button', { name: /^1 · Export notes file/ })

    expect(button).toBeDisabled()
    expect(button.title).toMatch(/who this review is about/i)
  })
})

// A team session is page-only: the notes FILE is a per-player artifact
// with an addressee, and a team has none. The page is the hand-over.
describe('CoachLoanSlip — a team session', () => {
  const team = () => renderSlip({
    player: { id: '', handle: 'Sound Barrier', message: '', kind: 'team' },
    source: 'replay',
    exported_at: '',
  })
  const teamSlip = () =>
    screen.getByRole('region', { name: 'Coaching session: reviewing Sound Barrier' })

  it('speaks team: the eyebrow, the corpus, the page', () => {
    team()
    expect(screen.getByText('Coaching session · team')).toBeInTheDocument()
    expect(within(teamSlip()).getByText(/6 replays/)).toBeInTheDocument()
    expect(within(teamSlip()).getByRole('button', { name: /Save a web page — for the team/ })).toBeInTheDocument()
  })

  // A team review used to be page-only, which left a captain who runs
  // Recall with nothing to import: they could read the coach's words in a
  // browser and then retype them. The file carries the addressee now, so
  // both hand-over routes are open and the steps number the same way they
  // do for a player.
  it('offers the notes file too, addressed to the team', () => {
    team()
    expect(within(teamSlip()).getByRole('button', { name: /Export notes file — for the team/ })).toBeInTheDocument()
    expect(within(teamSlip()).getByRole('button', { name: '2 · End session' })).toBeInTheDocument()
  })
})


// OW retires replay codes at season rollover. A coach who opens a bundle,
// reads the slip and only discovers at the first frame that nothing will
// load has spent the sitting's opening on a dead end.
describe('CoachLoanSlip — replay codes past their season', () => {
  const SEASONS = [
    { name: 'S1', chapter: 'C', number: 1, start: '2020-01-10T19:00:00Z', end: '2020-03-14T19:00:00Z' },
    { name: 'S2', chapter: 'C', number: 2, start: '2020-03-14T19:00:00Z', end: '2099-06-16T19:00:00Z' },
  ]

  function loaned(playedAt: string, code = 'DEAD01') {
    return {
      match_key: `match-${playedAt}`,
      source_files: [],
      data: { map: 'rialto', result: 'victory', played_at_utc: playedAt },
      annotation: { leavers: [], throwers: [], replay_code: code },
    }
  }

  function renderWithCorpus(records: unknown[]) {
    seedQuery(qk.system.referenceData, { heroes: [], maps: [], seasons: SEASONS })
    seedQuery(qk.coach.matches, records)
    return renderSlip()
  }

  it('warns when every code in the bundle predates the current season', async () => {
    renderWithCorpus([loaned('2020-02-01T20:00:00Z'), loaned('2020-02-02T20:00:00Z', 'DEAD02')])
    expect(await within(slip()).findByText(/predates the current season/i)).toBeInTheDocument()
  })

  // One live code makes the sitting worth having, and a warning that fired
  // on a mixed bundle would train the coach to ignore it.
  it('stays quiet when even one code is still live', () => {
    renderWithCorpus([loaned('2020-02-01T20:00:00Z'), loaned('2026-05-01T20:00:00Z', 'LIVE01')])
    expect(within(slip()).queryByText(/predates the current season/i)).toBeNull()
  })

  it('stays quiet when the bundle carries no codes at all', () => {
    renderWithCorpus([{
      match_key: 'm1', source_files: [], data: { map: 'rialto', played_at_utc: '2020-02-01T20:00:00Z' },
    }])
    expect(within(slip()).queryByText(/predates the current season/i)).toBeNull()
  })
})

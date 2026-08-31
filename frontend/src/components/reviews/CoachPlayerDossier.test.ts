import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import CoachPlayerDossier from '@/components/reviews/CoachPlayerDossier.vue'
import type { CoachPlayerSummary, CoachSession } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

const PLAYER: CoachPlayerSummary = {
  id: 2, handle: 'Sable', kind: 'player', note_count: 3,
  last_note_at: '2026-08-14T20:00:00Z',
  focus_items: ['Ult economy first.'],
}

function session(over: Partial<CoachSession> = {}): CoachSession {
  return {
    session_id: 's-1', handle: 'Sable', kind: 'player', source: 'bundle',
    opened_at: '2026-08-10T18:00:00Z',
    ended_at: '2026-08-10T19:20:00Z',
    match_keys: ['match-a', 'match-b'],
    focus_items: [{ text: 'Stop over-extending.', status: 'working' }],
    ...over,
  }
}

function renderDossier(sessions: CoachSession[] = [session()], player = PLAYER) {
  setActivePinia(createPinia())
  seedQuery(qk.coachPlayerSessions(player.id), sessions)
  return render(CoachPlayerDossier, { props: { player } })
}

const dossier = () => screen.getByRole('region', { name: /Sable — coaching dossier/ })

// The dossier is one coached identity's continuity. "Last session" used to
// mean "last note touched", because the database kept no record of when a
// coach actually sat down.
describe('CoachPlayerDossier', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('names the identity and what is standing', () => {
    renderDossier()
    expect(dossier()).toHaveTextContent('Sable')
    expect(dossier()).toHaveTextContent('Ult economy first.')
    expect(dossier()).toHaveTextContent(/3 notes/)
  })

  it('lists the sittings with what each covered', async () => {
    renderDossier()
    const list = await screen.findByRole('list', { name: 'Sessions' })
    expect(list).toHaveTextContent(/2 matches/)
    // What the focus list SAID then, which is the point of freezing it.
    expect(list).toHaveTextContent('Stop over-extending.')
  })

  // A coach who opened a bundle and walked away did something. Dropping the
  // row would misreport how often the two of them meet; a blank where a
  // duration goes would just look broken.
  it('says when a sitting was never ended', async () => {
    renderDossier([session({ ended_at: undefined })])
    const list = await screen.findByRole('list', { name: 'Sessions' })
    expect(list).toHaveTextContent(/never ended/i)
  })

  it('shows no session list at all before there is one', () => {
    renderDossier([])
    expect(screen.queryByRole('list', { name: 'Sessions' })).toBeNull()
  })

  // A sitting that froze nothing renders its line without an empty tail.
  it('omits the frozen list when the sitting had none', async () => {
    renderDossier([session({ focus_items: [] })])
    const list = await screen.findByRole('list', { name: 'Sessions' })
    expect(list).toHaveTextContent(/2 matches/)
    expect(list).not.toHaveTextContent('Stop over-extending.')
  })

  it('counts one match in the singular', async () => {
    renderDossier([session({ match_keys: ['match-a'] })])
    const list = await screen.findByRole('list', { name: 'Sessions' })
    expect(list).toHaveTextContent(/1 match(?!es)/)
  })

  // The note list is fetched on demand: a coach opens a dossier to glance
  // far more often than to re-read an entire file.
  it('keeps every note behind a disclosure', async () => {
    renderDossier()
    seedQuery(qk.coachPlayerNotes(PLAYER.id), [])
    const read = screen.getByRole('button', { name: 'Read every note' })
    expect(read).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(read)
    expect(read).toHaveAttribute('aria-expanded', 'true')
  })

  it('says so plainly when nobody has been written about yet', () => {
    renderDossier([], { ...PLAYER, note_count: 0, last_note_at: undefined, focus_items: [] })
    expect(dossier()).toHaveTextContent(/0 notes/)
    expect(dossier()).not.toHaveTextContent(/last note/)
  })
})

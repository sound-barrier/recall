import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, fireEvent } from '@testing-library/vue'

import CoachNavStrip from '@/components/coach/room/CoachNavStrip.vue'
import { setApiBacking } from '@/api-client'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useUiStore } from '@/stores/ui'

// The strip is the bridge between the film room and the six tabs running
// on the player's data: from the room it offers the way IN ("step into
// Sable's Matches"), from anywhere else the way BACK.

function view() {
  return {
    player: { id: 'sable-id', handle: 'Sable', message: '' },
    exported_at: '2026-08-14T18:30:00Z',
    session_date: '2026-08-15',
    match_count: 6,
    coach_name: 'Ordo',
    summary: '',
    notes: [],
    handle_from_bundle: true,
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  setApiBacking({
    ListCoachReturns: vi.fn(async () => []),
    GetCoachSessionMatches: vi.fn(async () => []),
    GetMatchResults: vi.fn(async () => []),
    GetNewScreenshotCount: vi.fn(async () => 0),
    GetFailedFiles: vi.fn(async () => []),
    GetVersion: vi.fn(async () => 'dev'),
    GetDataLocation: vi.fn(async () => null),
  })
})

// 'reviews' IS the room while a session is open — the strip's "in the room"
// and "on the Reviews tab" are the same fact.
function renderStrip(startView: 'reviews' | 'matches' | 'settings') {
  seedQuery(qk.coach.session, view())
  const coach = useCoachStore()
  const app = useAppStore()
  app.view = startView
  const goToView = vi.spyOn(app, 'goToView').mockResolvedValue(undefined)
  return { app, coach, goToView, rendered: render(CoachNavStrip) }
}

describe('CoachNavStrip — in the film room', () => {
  it("offers each of the player's views by name", () => {
    renderStrip('reviews')

    expect(screen.getByText(/Step into Sable's/)).toBeInTheDocument()
    for (const label of ['Matches', 'Trends', 'Compare', 'Elo']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
    expect(screen.queryByRole('button', { name: /Back to the film room/ })).not.toBeInTheDocument()
  })

  it('steps into a tab', async () => {
    const { goToView } = renderStrip('reviews')
    await fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(goToView).toHaveBeenCalledWith('compare')
  })

  // Trends is a SECTION of the Matches view, not a tab of its own: the
  // strip goes to Matches and asks it to open the section once.
  it('opens Trends by going to Matches and requesting the section', async () => {
    const { goToView } = renderStrip('reviews')
    const ui = useUiStore()

    await fireEvent.click(screen.getByRole('button', { name: 'Trends' }))

    expect(goToView).toHaveBeenCalledWith('matches')
    expect(ui.trendsOpenRequested).toBe(true)
  })
})

describe('CoachNavStrip — on a tab', () => {
  it('shows the way back instead of the way in', () => {
    renderStrip('matches')

    expect(screen.getByRole('button', { name: /Back to the film room/ })).toBeInTheDocument()
    expect(screen.queryByText(/Step into/)).not.toBeInTheDocument()
  })

  it('returns to the room', async () => {
    const { goToView } = renderStrip('settings')
    await fireEvent.click(screen.getByRole('button', { name: /Back to the film room/ }))
    expect(goToView).toHaveBeenCalledWith('reviews')
  })
})

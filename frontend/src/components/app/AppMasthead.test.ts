import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/vue'

import { flushPromises, renderApp } from '@/test-utils'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// The masthead changes hands while a bundle is open: the loan slip answers
// "whose data is this" where the profile chip used to, the scoreboard steps
// aside (it would be tallying the player's set), and the session chrome —
// rule + nav strip — rides along on every view. Everything that belongs to
// the COACH's own app (watch dot, parse chip, version, ⋮ menu) stays.

const SESSION = {
  player: { id: 'sable-id', handle: 'Sable', message: '' },
  exported_at: '2026-08-14T18:30:00Z',
  session_date: '2026-08-15',
  match_count: 6,
  coach_name: 'Ordo',
  summary: '',
  notes: [],
  handle_from_bundle: true,
}

// renderApp installs a fresh QueryClient, so the session is seeded AFTER
// the render and the store's observer picks it up on the next flush.
async function renderInSession() {
  const view = await renderApp()
  seedQuery(qk.coach.session, SESSION)
  await flushPromises()
  await flushPromises()
  return view
}

// The chip's glyph + chevron are aria-hidden, so its accessible name is
// exactly the active profile.
const profileChip = () => screen.queryByRole('button', { name: 'main' })
const slip = () => screen.queryByRole('region', { name: 'Coaching session: reviewing Sable' })

describe('AppMasthead — outside a coaching session', () => {
  it('keeps the profile switcher and shows no session chrome', async () => {
    await renderApp()

    expect(profileChip()).toBeInTheDocument()
    expect(slip()).not.toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Coaching session' })).not.toBeInTheDocument()
  })
})

describe('AppMasthead — in a coaching session', () => {
  it('swaps the profile chip for the loan slip', async () => {
    await renderInSession()

    expect(slip()).toBeInTheDocument()
    expect(profileChip()).not.toBeInTheDocument()
  })

  it("keeps the coach's own chrome — the app underneath is still theirs", async () => {
    await renderInSession()

    // The ⋮ menu and the version block belong to the coach's install, not
    // to the loan, and must survive the swap.
    expect(screen.getByRole('button', { name: /menu/i })).toBeInTheDocument()
  })

  it('shows the way back to the film room on a tab', async () => {
    await renderInSession()
    expect(screen.getByRole('button', { name: /Back to the film room/ })).toBeInTheDocument()
  })

  // The tablist has no selected tab while the room is up, but the
  // roving-tabindex rule still needs exactly one tab in the tab order.
  it('parks the tab stop on Matches while the film room is the view', async () => {
    await renderInSession()
    const { useAppStore } = await import('@/stores/app')
    await useAppStore().goToView('coach')
    await flushPromises()

    expect(screen.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: 'Settings' })).toHaveAttribute('tabindex', '-1')
  })
})

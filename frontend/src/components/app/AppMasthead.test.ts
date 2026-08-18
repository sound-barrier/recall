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

  // A resumed session now lands IN the room, so getting to a tab is a
  // deliberate step — which is the state this is about: the coach stepped
  // into the player's Matches and needs the way back.
  it('shows the way back to the film room on a tab', async () => {
    await renderInSession()
    const { useAppStore } = await import('@/stores/app')
    await useAppStore().goToView('matches')
    await flushPromises()

    expect(screen.getByRole('button', { name: /Back to the film room/ })).toBeInTheDocument()
  })

  // The room is the Reviews tab's content, so while it is up the Reviews tab
  // is the selected one — the roving tab stop lands there like any other
  // view. (It used to park on Matches by hand, because the room had no tab.)
  it('selects the Reviews tab while the film room is the view', async () => {
    await renderInSession()
    const { useAppStore } = await import('@/stores/app')
    await useAppStore().goToView('reviews')
    await flushPromises()

    expect(screen.getByRole('tab', { name: /^Reviews/ })).toHaveAttribute('tabindex', '0')
    expect(screen.getByRole('tab', { name: /^Reviews/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: /^Matches/ })).toHaveAttribute('tabindex', '-1')
  })
})

describe('AppMasthead — the tab set', () => {
  // Six hand-written buttons with literal 01–06 used to carry the tablist,
  // and nothing checked they agreed with TAB_ORDER: a tab in the array but
  // not the masthead compiled and silently had no button. The set is one
  // definition now, and this pins that the rendered tabs ARE it.
  it('renders exactly TAB_ORDER, numbered by position', async () => {
    const { TAB_ORDER, TAB_LABELS } = await import('@/composables/shared/keyboard/useTabKeyboardNav')
    await renderApp()

    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((t) => t.id)).toEqual(TAB_ORDER.map((id) => `tab-${id}`))
    TAB_ORDER.forEach((id, i) => {
      const num = String(i + 1).padStart(2, '0')
      expect(tabs[i]).toHaveTextContent(new RegExp(`^${num}\\s*${TAB_LABELS[id]}`))
    })
  })
})

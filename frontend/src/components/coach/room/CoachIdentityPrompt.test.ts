import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, expect, it } from 'vitest'

import CoachIdentityPrompt from '@/components/coach/room/CoachIdentityPrompt.vue'

// The room's "Who is this?" — and, for codes, WHAT. A bundle already named
// its player, so the player/team fork renders only over replay codes.

function renderPrompt(props: Record<string, unknown> = {}) {
  return render(CoachIdentityPrompt, { props: { unconfirmed: true, source: 'replay', ...props } })
}

describe('CoachIdentityPrompt — the fork', () => {
  it('offers player or team over codes, and files the answer with the name', async () => {
    const view = renderPrompt()
    expect(screen.getByRole('radiogroup', { name: 'Who this review is about' })).toBeInTheDocument()

    await fireEvent.click(screen.getByRole('radio', { name: 'A team' }))
    // The field follows the answer.
    await fireEvent.update(screen.getByLabelText('Team name'), 'Sound Barrier')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(view.emitted('confirm')?.at(-1)).toEqual(['Sound Barrier', 'team'])
  })

  it('defaults to a player, by name', async () => {
    const view = renderPrompt()
    await fireEvent.update(screen.getByLabelText('Player handle'), 'Sable')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(view.emitted('confirm')?.at(-1)).toEqual(['Sable', 'player'])
  })

  it('never offers the fork over a bundle — the manifest named its player', async () => {
    const view = renderPrompt({ source: 'bundle' })
    expect(screen.queryByRole('radiogroup')).toBeNull()
    await fireEvent.update(screen.getByLabelText('Player handle'), 'Sable')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(view.emitted('confirm')?.at(-1)).toEqual(['Sable', 'player'])
  })

  it('moves like a radio group: arrows move AND select', async () => {
    renderPrompt()
    const group = screen.getByRole('radiogroup', { name: 'Who this review is about' })
    await fireEvent.keyDown(group, { key: 'ArrowRight' })
    expect(screen.getByRole('radio', { name: 'A team' })).toHaveAttribute('aria-checked', 'true')
  })
})

// The correction path: a team session re-opens the prompt to fix a typo in
// the NAME — the fork must show the session's actual kind, or confirming
// silently re-files the whole review under a fresh player row.
describe('CoachIdentityPrompt — correcting a team', () => {
  it('seeds the fork from the session and keeps team on confirm', async () => {
    const view = renderPrompt({ unconfirmed: false, handle: 'Sound Barrier', kind: 'team' })
    expect(screen.getByRole('radio', { name: 'A team' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByLabelText('Team name')).toBeInTheDocument()

    await fireEvent.update(screen.getByLabelText('Team name'), 'Sound Barrier EU')
    await fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(view.emitted('confirm')?.at(-1)).toEqual(['Sound Barrier EU', 'team'])
  })
})

// The typeahead offers the roster's names OF THE FORK'S KIND — a split
// history is what the dossier stands on, so a known name must be one
// keystroke away and a team name must never suggest itself for a player.
describe('CoachIdentityPrompt — the typeahead', () => {
  const KNOWN = [
    { handle: 'Sable', kind: 'player' as const },
    { handle: 'Sound Barrier', kind: 'team' as const },
  ]

  it('filters suggestions by the fork', async () => {
    renderPrompt({ knownIdentities: KNOWN })
    // eslint-disable-next-line testing-library/no-node-access -- a native datalist has no ARIA role to query
    let options = [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(options).toEqual(['Sable'])

    await fireEvent.click(screen.getByRole('radio', { name: 'A team' }))
    // eslint-disable-next-line testing-library/no-node-access -- a native datalist has no ARIA role to query
    options = [...document.querySelectorAll('datalist option')].map((o) => o.getAttribute('value'))
    expect(options).toEqual(['Sound Barrier'])
  })

  it('renders no datalist and no hint over an empty roster', () => {
    renderPrompt()
    // eslint-disable-next-line testing-library/no-node-access -- a native datalist has no ARIA role to query
    expect(document.querySelector('datalist')).toBeNull()
    expect(screen.queryByText(/existing history/)).toBeNull()
  })
})


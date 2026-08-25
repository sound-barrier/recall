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

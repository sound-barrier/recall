import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'

import MatchExclusionChooser from '@/components/matches/detail/MatchExclusionChooser.vue'

function renderChooser(current = '' as '' | 'placement' | 'mmr_adjustment' | 'outage', locked = false) {
  return render(MatchExclusionChooser, {
    props: { current, writesLocked: locked, lockReason: locked ? 'A coaching session is open.' : '' },
  })
}

const chip = (name: string) => screen.getByRole('button', { name })

// Why a match should not count. Independent toggles rather than a
// radiogroup: clicking the live reason clears it, which is the only "unset"
// a user ever wants.
describe('MatchExclusionChooser', () => {
  it('offers each reason under a name a screen reader can read aloud', () => {
    renderChooser()
    expect(chip('Mark this match as a placement')).toBeInTheDocument()
    expect(chip('Mark this match as an MMR adjustment')).toBeInTheDocument()
    expect(chip('Mark this match as an outage')).toBeInTheDocument()
  })

  it('reports which reason is live through aria-pressed', () => {
    renderChooser('placement')
    expect(chip('Mark this match as a placement')).toHaveAttribute('aria-pressed', 'true')
    expect(chip('Mark this match as an outage')).toHaveAttribute('aria-pressed', 'false')
  })

  it('emits the reason that was picked', async () => {
    const { emitted } = renderChooser()
    await userEvent.click(chip('Mark this match as an outage'))
    expect(emitted()['set-exclusion']).toEqual([['outage']])
  })

  // A match carries at most one reason — these are alternatives, not a set.
  it('replaces the live reason rather than adding to it', async () => {
    const { emitted } = renderChooser('placement')
    await userEvent.click(chip('Mark this match as an MMR adjustment'))
    expect(emitted()['set-exclusion']).toEqual([['mmr_adjustment']])
  })

  it('clears when the live reason is clicked again', async () => {
    const { emitted } = renderChooser('placement')
    await userEvent.click(chip('Mark this match as a placement'))
    expect(emitted()['set-exclusion']).toEqual([['']])
  })

  // The frontend gate is defense in depth — the server refuses the same
  // write — but a button that stays enabled is still a lie to the user.
  it('is refused, with the reason, while writes are locked', async () => {
    const { emitted } = renderChooser('', true)
    const placement = chip('Mark this match as a placement')
    expect(placement).toBeDisabled()
    expect(placement).toHaveAttribute('title', 'A coaching session is open.')
    await userEvent.click(placement)
    expect(emitted()['set-exclusion']).toBeUndefined()
  })
})

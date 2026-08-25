import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, it, expect, vi } from 'vitest'

import CoachFromCodesModal from '@/components/reviews/CoachFromCodesModal.vue'
import { useCoachStore } from '@/stores/coach'

// Starting a review from the six characters a coach was given in chat,
// rather than from a bundle a player exported.
beforeEach(() => { setActivePinia(createPinia()) })

function renderModal() {
  const coach = useCoachStore()
  const open = vi.spyOn(coach, 'openFromReplayCodes').mockResolvedValue(undefined)
  const view = render(CoachFromCodesModal, { props: { modelValue: true } })
  return { coach, open, view }
}

const field = () => screen.getByRole('textbox', { name: 'Replay code' })
const addBtn = () => screen.getByRole('button', { name: 'Add' })
const startBtn = () => screen.getByRole('button', { name: 'Start review' })

describe('CoachFromCodesModal', () => {
  // One name end to end: the button that opened it is the name it wears.
  it('wears the name of the button that opened it', () => {
    renderModal()
    expect(screen.getByRole('dialog', { name: 'Use a replay code' })).toBeInTheDocument()
    expect(screen.getByText(/Recall can't show anything from a code/)).toBeInTheDocument()
    expect(screen.getByText(/how the player's Recall finds the match/)).toBeInTheDocument()
    expect(screen.getByText(/Add at least one code to start/)).toBeInTheDocument()
  })

  it('cannot start a review of nothing', () => {
    renderModal()
    expect(startBtn()).toBeDisabled()
  })

  // The code is echoed back before the review starts. It is now the player's
  // identity for that match, so a typo produces a review they can never be
  // matched to — and this is the only place to catch it.
  it('echoes each code back in its canonical form', async () => {
    renderModal()
    await fireEvent.update(field(), 'a1b2c3')
    await fireEvent.click(addBtn())
    expect(screen.getByText('A1B2C3')).toBeInTheDocument()
  })

  it('will not add something that is not a code', async () => {
    renderModal()
    await fireEvent.update(field(), 'A1B')
    expect(addBtn()).toBeDisabled()
  })

  it('collapses a code added twice, because one code is one match', async () => {
    renderModal()
    for (const code of ['A1B2C3', 'a1b2c3']) {
      await fireEvent.update(field(), code)
      await fireEvent.click(addBtn())
    }
    expect(screen.getAllByText('A1B2C3')).toHaveLength(1)
  })

  it('lets a code be taken back off the list', async () => {
    renderModal()
    await fireEvent.update(field(), 'A1B2C3')
    await fireEvent.click(addBtn())
    await fireEvent.click(screen.getByRole('button', { name: 'Remove A1B2C3' }))
    expect(screen.queryByText('A1B2C3')).not.toBeInTheDocument()
    expect(startBtn()).toBeDisabled()
  })

  it('opens the session with every code, in the order they were added', async () => {
    const { open } = renderModal()
    for (const code of ['A1B2C3', 'D4E5F6']) {
      await fireEvent.update(field(), code)
      await fireEvent.click(addBtn())
    }
    await fireEvent.click(startBtn())
    expect(open).toHaveBeenCalledWith(['A1B2C3', 'D4E5F6'], undefined)
  })
})

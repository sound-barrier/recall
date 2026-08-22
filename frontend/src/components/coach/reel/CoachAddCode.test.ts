import { render, screen, fireEvent } from '@testing-library/vue'
import { describe, it, expect, vi } from 'vitest'

import CoachAddCode from '@/components/coach/reel/CoachAddCode.vue'

// Adding a replay to a review that is already running. Codes arrive one at a
// time over voice chat — "watch A1B2C3 too" — so the reel has to grow while
// the coach works rather than being fixed when the session opened.
function renderAddCode() {
  const add = vi.fn()
  const view = render(CoachAddCode, { props: { add } })
  return { add, view }
}

async function openForm() {
  await fireEvent.click(screen.getByRole('button', { name: /add a replay code/i }))
  return screen.getByRole('textbox', { name: 'Replay code' })
}

describe('CoachAddCode', () => {
  it('stays out of the way until asked for', () => {
    renderAddCode()
    expect(screen.getByRole('button', { name: /add a replay code/i })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Replay code' })).not.toBeInTheDocument()
  })

  it('takes the digits and shapes the code itself', async () => {
    const { add } = renderAddCode()
    const field = await openForm()

    await fireEvent.update(field, 'a1b2c3')
    expect(field).toHaveValue('A1B2C3')

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(add).toHaveBeenCalledWith('A1B2C3')
  })

  // A half-typed code is not a code. Handing one up would mint a key that
  // exists on nobody's machine.
  it('will not add a code that is not one', async () => {
    const { add } = renderAddCode()
    const field = await openForm()

    await fireEvent.update(field, 'A1B')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()

    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    expect(add).not.toHaveBeenCalled()
  })

  it('drops characters a replay code can never hold', async () => {
    renderAddCode()
    const field = await openForm()
    await fireEvent.update(field, 'a1b2-c3d4')
    expect(field).toHaveValue('A1B2C3')
  })

  it('closes and forgets the draft on cancel', async () => {
    const { add } = renderAddCode()
    const field = await openForm()
    await fireEvent.update(field, 'A1B2C3')

    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(add).not.toHaveBeenCalled()
    expect(screen.queryByRole('textbox', { name: 'Replay code' })).not.toBeInTheDocument()

    const reopened = await openForm()
    expect(reopened).toHaveValue('')
  })

  it('folds itself away after a code goes in, ready for the next one', async () => {
    const { add } = renderAddCode()
    const field = await openForm()
    await fireEvent.update(field, 'D4E5F6')
    await fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(add).toHaveBeenCalledWith('D4E5F6')
    expect(screen.getByRole('button', { name: /add a replay code/i })).toBeInTheDocument()
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import { setApiBacking } from '@/api-client'
import SettingsCoach from '@/components/settings/SettingsCoach.vue'
import { flushPromises } from '@/test-utils'

// The name a coach signs notes with. It is a SERVER setting (the exported
// ledger is rendered server-side and needs it), so the row reads it on
// mount and commits it on blur / Enter.

const GetCoachName = vi.fn(async () => 'Ordo')
const SetCoachName = vi.fn(async (name: string) => name)

function renderRow() {
  setActivePinia(createPinia())
  setApiBacking({ GetCoachName, SetCoachName })
  return render(SettingsCoach)
}

const field = () => screen.getByLabelText('Your coach name')

describe('SettingsCoach', () => {
  beforeEach(() => {
    GetCoachName.mockClear()
    SetCoachName.mockClear()
  })

  it('shows the name the server already has', async () => {
    renderRow()
    await flushPromises()
    expect(GetCoachName).toHaveBeenCalled()
    expect(field()).toHaveValue('Ordo')
  })

  it('saves a new name on blur, trimmed', async () => {
    const user = userEvent.setup()
    renderRow()
    await flushPromises()
    await user.clear(field())
    await user.type(field(), '  Vex  ')
    await user.tab()
    await flushPromises()
    expect(SetCoachName).toHaveBeenCalledWith('Vex')
    expect(field()).toHaveValue('Vex')
  })

  it('does not re-save a name that did not change', async () => {
    const user = userEvent.setup()
    renderRow()
    await flushPromises()
    await user.click(field())
    await user.tab()
    await flushPromises()
    expect(SetCoachName).not.toHaveBeenCalled()
  })

  it('puts the old name back when the save fails', async () => {
    const user = userEvent.setup()
    SetCoachName.mockRejectedValueOnce(new Error('nope'))
    renderRow()
    await flushPromises()
    await user.clear(field())
    await user.type(field(), 'Vex')
    await user.tab()
    await flushPromises()
    expect(field()).toHaveValue('Ordo')
  })
})

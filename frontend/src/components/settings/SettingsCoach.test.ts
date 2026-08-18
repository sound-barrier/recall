import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { createPinia, setActivePinia } from 'pinia'

import { setApiBacking } from '@/api-client'
import SettingsCoach from '@/components/settings/SettingsCoach.vue'
import { flushPromises } from '@/test-utils'

// The two coaching identities, one per direction of the loop. Both are
// SERVER settings — the exported ledger is rendered server-side and needs
// the coach name, the handle is stamped into a shared bundle's manifest —
// so the section reads them on mount and commits on blur / Enter.

const STORED = { coach_name: 'Ordo', player_handle: 'Sable' }
const GetCoachingSettings = vi.fn(async () => ({ ...STORED }))
const SetCoachingSettings = vi.fn(async (next: typeof STORED) => next)

function renderRow() {
  setActivePinia(createPinia())
  setApiBacking({ GetCoachingSettings, SetCoachingSettings })
  return render(SettingsCoach)
}

const coachField = () => screen.getByLabelText('Your coach name')
const handleField = () => screen.getByLabelText('Your player handle')

describe('SettingsCoach', () => {
  beforeEach(() => {
    GetCoachingSettings.mockClear()
    SetCoachingSettings.mockClear()
    GetCoachingSettings.mockResolvedValue({ ...STORED })
  })

  it('shows both identities the server already has', async () => {
    renderRow()
    await flushPromises()
    expect(GetCoachingSettings).toHaveBeenCalled()
    expect(coachField()).toHaveValue('Ordo')
    expect(handleField()).toHaveValue('Sable')
  })

  it('saves a new coach name on blur, trimmed', async () => {
    const user = userEvent.setup()
    renderRow()
    await flushPromises()
    await user.clear(coachField())
    await user.type(coachField(), '  Vex  ')
    await user.tab()
    await flushPromises()
    expect(SetCoachingSettings).toHaveBeenCalledWith({ coach_name: 'Vex', player_handle: 'Sable' })
    expect(coachField()).toHaveValue('Vex')
  })

  // The handle used to be settable only as a side effect of sharing, and
  // shown nowhere — so the share dialog asked for it again every time, on a
  // value the server had all along.
  it('saves a new player handle, carrying the coach name along', async () => {
    const user = userEvent.setup()
    renderRow()
    await flushPromises()
    await user.clear(handleField())
    await user.type(handleField(), 'Wren')
    await user.tab()
    await flushPromises()
    expect(SetCoachingSettings).toHaveBeenCalledWith({ coach_name: 'Ordo', player_handle: 'Wren' })
    expect(handleField()).toHaveValue('Wren')
  })

  it('does not re-save what did not change', async () => {
    const user = userEvent.setup()
    renderRow()
    await flushPromises()
    await user.click(coachField())
    await user.tab()
    await flushPromises()
    expect(SetCoachingSettings).not.toHaveBeenCalled()
  })

  it('puts the stored values back when the save fails', async () => {
    const user = userEvent.setup()
    SetCoachingSettings.mockRejectedValueOnce(new Error('nope'))
    renderRow()
    await flushPromises()
    await user.clear(coachField())
    await user.type(coachField(), 'Vex')
    await user.tab()
    await flushPromises()
    expect(coachField()).toHaveValue('Ordo')
    expect(handleField()).toHaveValue('Sable')
  })
})

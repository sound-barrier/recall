import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'

// vi.mock factories are hoisted above all imports; vi.hoisted lets the
// spies share scope with the factory without "cannot access before
// initialization." Same shape as ProfileSwitcher.test.ts.
const { GetProfilesMock, DeleteProfileMock } = vi.hoisted(() => ({
  GetProfilesMock:   vi.fn(),
  DeleteProfileMock: vi.fn(),
}))
vi.mock('@/api', () => ({
  GetProfiles:   GetProfilesMock,
  DeleteProfile: DeleteProfileMock,
}))

import SettingsProfiles from '@/components/settings/SettingsProfiles.vue'

beforeEach(() => {
  GetProfilesMock.mockReset()
  DeleteProfileMock.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

const user = () => userEvent.setup()
const rows = () => screen.getAllByRole('listitem')
const rowNames = () => rows().map((r) => r.getAttribute('data-profile'))

describe('SettingsProfiles', () => {
  it('renders every profile sorted alphabetically and tags the active one', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt', 'smurf'] })
    render(SettingsProfiles)
    await flushPromises()
    expect(rowNames()).toEqual(['alt', 'main', 'smurf'])
    // Active is marked + has no Delete button.
    const active = rows()[1]!
    expect(active).toHaveClass('active')
    expect(within(active).getByText('Active')).toBeInTheDocument()
    expect(within(active).queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
  })

  it('non-active rows expose a Delete button with two-step confirm', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    render(SettingsProfiles)
    await flushPromises()
    await user().click(screen.getByRole('button', { name: 'Delete profile alt' }))
    expect(screen.getByRole('button', { name: 'Confirm delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete profile alt' })).not.toBeInTheDocument()
  })

  it('Cancel returns the row to its idle state without firing DeleteProfile', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    render(SettingsProfiles)
    await flushPromises()
    await user().click(screen.getByRole('button', { name: 'Delete profile alt' }))
    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Delete profile alt' })).toBeInTheDocument()
    expect(DeleteProfileMock).not.toHaveBeenCalled()
  })

  it('Confirm fires DeleteProfile(name) and re-fetches the list', async () => {
    GetProfilesMock.mockResolvedValueOnce({ active: 'main', profiles: ['main', 'alt'] })
    DeleteProfileMock.mockResolvedValue({ active: 'main', profiles: ['main'] })
    GetProfilesMock.mockResolvedValueOnce({ active: 'main', profiles: ['main'] })
    render(SettingsProfiles)
    await flushPromises()
    await user().click(screen.getByRole('button', { name: 'Delete profile alt' }))
    await user().click(screen.getByRole('button', { name: 'Confirm delete' }))
    await flushPromises()

    expect(DeleteProfileMock).toHaveBeenCalledWith('alt')
    // After confirm + reload, only `main` remains.
    expect(rowNames()).toEqual(['main'])
  })

  it('surfaces an error message if DeleteProfile rejects', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    DeleteProfileMock.mockRejectedValue(new Error('profile is active'))
    render(SettingsProfiles)
    await flushPromises()
    await user().click(screen.getByRole('button', { name: 'Delete profile alt' }))
    await user().click(screen.getByRole('button', { name: 'Confirm delete' }))
    await flushPromises()
    expect(screen.getByText(/profile is active/)).toBeInTheDocument()
  })
})

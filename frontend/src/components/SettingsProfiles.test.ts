import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

// vi.mock factories are hoisted above all imports; vi.hoisted lets the
// spies share scope with the factory without "cannot access before
// initialization." Same shape as ProfileSwitcher.test.ts.
const { GetProfilesMock, DeleteProfileMock } = vi.hoisted(() => ({
  GetProfilesMock:   vi.fn(),
  DeleteProfileMock: vi.fn(),
}))
vi.mock('../api', () => ({
  GetProfiles:   GetProfilesMock,
  DeleteProfile: DeleteProfileMock,
}))

import SettingsProfiles from './SettingsProfiles.vue'

beforeEach(() => {
  GetProfilesMock.mockReset()
  DeleteProfileMock.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('SettingsProfiles', () => {
  it('renders every profile sorted alphabetically and tags the active one', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt', 'smurf'] })
    const w = mount(SettingsProfiles)
    await flushPromises()
    const rows = w.findAll('.profile-mgmt-row')
    expect(rows.map((r) => r.attributes('data-profile'))).toEqual(['alt', 'main', 'smurf'])
    // Active is marked + has no Delete button.
    const active = w.find('.profile-mgmt-row.active')
    expect(active.attributes('data-profile')).toBe('main')
    expect(active.find('.profile-mgmt-delete').exists()).toBe(false)
    expect(active.find('.profile-mgmt-active-tag').exists()).toBe(true)
  })

  it('non-active rows expose a Delete button with two-step confirm', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    const w = mount(SettingsProfiles)
    await flushPromises()
    const altRow = w.findAll('.profile-mgmt-row').find((r) => r.attributes('data-profile') === 'alt')!
    expect(altRow.find('.profile-mgmt-delete').exists()).toBe(true)

    await altRow.find('.profile-mgmt-delete').trigger('click')
    expect(altRow.find('.profile-mgmt-delete-confirm').exists()).toBe(true)
    expect(altRow.find('.profile-mgmt-delete-cancel').exists()).toBe(true)
    expect(altRow.find('.profile-mgmt-delete').exists()).toBe(false)
  })

  it('Cancel returns the row to its idle state without firing DeleteProfile', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    const w = mount(SettingsProfiles)
    await flushPromises()
    const altRow = w.findAll('.profile-mgmt-row').find((r) => r.attributes('data-profile') === 'alt')!
    await altRow.find('.profile-mgmt-delete').trigger('click')
    await altRow.find('.profile-mgmt-delete-cancel').trigger('click')
    expect(altRow.find('.profile-mgmt-delete').exists()).toBe(true)
    expect(DeleteProfileMock).not.toHaveBeenCalled()
  })

  it('Confirm fires DeleteProfile(name) and re-fetches the list', async () => {
    GetProfilesMock.mockResolvedValueOnce({ active: 'main', profiles: ['main', 'alt'] })
    DeleteProfileMock.mockResolvedValue({ active: 'main', profiles: ['main'] })
    GetProfilesMock.mockResolvedValueOnce({ active: 'main', profiles: ['main'] })
    const w = mount(SettingsProfiles)
    await flushPromises()
    const altRow = w.findAll('.profile-mgmt-row').find((r) => r.attributes('data-profile') === 'alt')!
    await altRow.find('.profile-mgmt-delete').trigger('click')
    await altRow.find('.profile-mgmt-delete-confirm').trigger('click')
    await flushPromises()

    expect(DeleteProfileMock).toHaveBeenCalledWith('alt')
    // After confirm + reload, only `main` remains.
    const rows = w.findAll('.profile-mgmt-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.attributes('data-profile')).toBe('main')
  })

  it('surfaces an error message if DeleteProfile rejects', async () => {
    GetProfilesMock.mockResolvedValue({ active: 'main', profiles: ['main', 'alt'] })
    DeleteProfileMock.mockRejectedValue(new Error('profile is active'))
    const w = mount(SettingsProfiles)
    await flushPromises()
    const altRow = w.findAll('.profile-mgmt-row').find((r) => r.attributes('data-profile') === 'alt')!
    await altRow.find('.profile-mgmt-delete').trigger('click')
    await altRow.find('.profile-mgmt-delete-confirm').trigger('click')
    await flushPromises()
    expect(w.find('.profile-mgmt-error').exists()).toBe(true)
    expect(w.find('.profile-mgmt-error').text()).toContain('profile is active')
  })
})

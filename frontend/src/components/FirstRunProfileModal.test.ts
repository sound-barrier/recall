import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { RenameProfileMock } = vi.hoisted(() => ({ RenameProfileMock: vi.fn() }))
vi.mock('../api', () => ({
  RenameProfile: RenameProfileMock,
}))

import FirstRunProfileModal from './FirstRunProfileModal.vue'

beforeEach(() => {
  RenameProfileMock.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

describe('FirstRunProfileModal', () => {
  it('renders the Main account name prompt + Save / Keep buttons', () => {
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    expect(w.find('.first-run-modal').exists()).toBe(true)
    expect(w.find('.first-run-title').text()).toContain('Main account name')
    expect(w.find('.first-run-save').exists()).toBe(true)
    expect(w.find('.first-run-keep').exists()).toBe(true)
  })

  it('disables Save until a valid name is typed', async () => {
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    expect((w.find('.first-run-save').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('.first-run-input').setValue('SilentStorm')
    expect((w.find('.first-run-save').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the hint and disables Save for an invalid name', async () => {
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    await w.find('.first-run-input').setValue('../traversal')
    expect((w.find('.first-run-save').element as HTMLButtonElement).disabled).toBe(true)
    expect(w.find('.first-run-hint').exists()).toBe(true)
  })

  it('Save calls RenameProfile("main", value) and emits dismiss with the new name', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    expect(RenameProfileMock).toHaveBeenCalledWith('main', 'SilentStorm')
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual(['SilentStorm'])
  })

  it('Keep as "main" emits dismiss with null (no rename call)', async () => {
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    await w.find('.first-run-keep').trigger('click')
    expect(RenameProfileMock).not.toHaveBeenCalled()
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual([null])
  })

  it('surfaces an error and does NOT emit dismiss when RenameProfile rejects', async () => {
    RenameProfileMock.mockRejectedValue(new Error('boom'))
    const w = mount(FirstRunProfileModal, { attachTo: document.body })
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    expect(w.find('.first-run-error').text()).toContain('boom')
    expect(w.emitted('dismiss')).toBeFalsy()
  })
})

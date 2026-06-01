import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// The component talks to the api module — stub it before importing
// the SFC so the live wrapper never fires. vi.mock factories are
// hoisted; vi.hoisted lets the spies share scope with the factory
// without hitting "cannot access before initialization."
const { GetProfiles, SwitchProfile, CreateProfile } = vi.hoisted(() => ({
  GetProfiles:   vi.fn(),
  SwitchProfile: vi.fn(),
  CreateProfile: vi.fn(),
}))
vi.mock('../api', () => ({
  GetProfiles,
  SwitchProfile,
  CreateProfile,
}))

// window.location.reload is the post-switch sweep — replace it with
// a spy so the test doesn't actually trigger a jsdom reload (which
// would tear down the wrapper before assertions complete).
const reloadSpy = vi.fn()
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { reload: reloadSpy, href: '/' },
})

import ProfileSwitcher from './ProfileSwitcher.vue'

beforeEach(() => {
  GetProfiles.mockReset()
  SwitchProfile.mockReset()
  CreateProfile.mockReset()
  reloadSpy.mockReset()
})

async function mountChip(profiles: string[] = ['main'], active = 'main') {
  GetProfiles.mockResolvedValue({ active, profiles })
  const wrapper = mount(ProfileSwitcher, { attachTo: document.body })
  await flushPromises()
  return wrapper
}

describe('ProfileSwitcher — masthead chip', () => {
  it('renders the active profile name in the chip on mount', async () => {
    const wrapper = await mountChip(['main', 'alt'], 'main')
    expect(wrapper.find('.profile-chip').text()).toContain('main')
    // Dropdown is closed by default — no menu items rendered.
    expect(wrapper.find('.profile-menu').exists()).toBe(false)
  })

  it('clicking the chip opens the dropdown with every known profile', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    expect(wrapper.find('.profile-menu').exists()).toBe(true)
    const items = wrapper.findAll('.profile-item .profile-item-name')
    // The "+ New profile…" item shares the .profile-item class — slice it off.
    const names = items.slice(0, 2).map((n) => n.text())
    expect(names).toEqual(['alt', 'main'])
    // Active profile carries the .active class.
    const activeItem = wrapper.find('.profile-item.active')
    expect(activeItem.text()).toContain('main')
  })

  it('clicking a non-active profile fires SwitchProfile and reloads', async () => {
    SwitchProfile.mockResolvedValue({ active: 'alt', profiles: ['alt', 'main'] })
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')

    // Items are in the order [alt, main, +new]; alt is the first.
    await wrapper.findAll('.profile-item')[0]!.trigger('click')
    await flushPromises()

    expect(SwitchProfile).toHaveBeenCalledWith('alt')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('clicking the active profile is a no-op (no SwitchProfile, no reload)', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')

    // main is the second item in [alt, main]. .active item is main.
    await wrapper.find('.profile-item.active').trigger('click')
    await flushPromises()

    expect(SwitchProfile).not.toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('"New profile…" opens an inline name input', async () => {
    const wrapper = await mountChip(['main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.find('.profile-new-trigger').trigger('click')

    expect(wrapper.find('.profile-new-form').exists()).toBe(true)
    expect(wrapper.find('.profile-new-input').exists()).toBe(true)
  })

  it('Create with a valid name fires CreateProfile and reloads', async () => {
    CreateProfile.mockResolvedValue({ active: 'alt', profiles: ['alt', 'main'] })
    const wrapper = await mountChip(['main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.find('.profile-new-trigger').trigger('click')

    await wrapper.find('.profile-new-input').setValue('alt')
    await wrapper.find('.profile-new-form').trigger('submit')
    await flushPromises()

    expect(CreateProfile).toHaveBeenCalledWith('alt')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('Create with an invalid name disables the submit button + shows the hint', async () => {
    const wrapper = await mountChip(['main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.find('.profile-new-trigger').trigger('click')

    await wrapper.find('.profile-new-input').setValue('../traversal')
    expect((wrapper.find('.profile-new-confirm').element as HTMLButtonElement).disabled).toBe(true)
    expect(wrapper.find('.profile-new-hint').exists()).toBe(true)
    expect(wrapper.find('.profile-new-hint').text()).toContain('a–z')
  })

  it('Cancel exits the new-profile form without firing Create', async () => {
    const wrapper = await mountChip(['main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.find('.profile-new-trigger').trigger('click')
    await wrapper.find('.profile-new-input').setValue('alt')

    await wrapper.find('.profile-new-cancel').trigger('click')
    expect(wrapper.find('.profile-new-form').exists()).toBe(false)
    expect(wrapper.find('.profile-new-trigger').exists()).toBe(true)
    expect(CreateProfile).not.toHaveBeenCalled()
  })
})

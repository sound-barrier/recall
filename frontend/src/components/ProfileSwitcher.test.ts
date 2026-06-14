import { describe, expect, it, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// The component talks to the api module — stub it before importing
// the SFC so the live wrapper never fires. vi.mock factories are
// hoisted; vi.hoisted lets the spies share scope with the factory
// without hitting "cannot access before initialization."
const { GetProfiles, SwitchProfile, CreateProfile, RenameProfile } = vi.hoisted(() => ({
  GetProfiles:   vi.fn(),
  SwitchProfile: vi.fn(),
  CreateProfile: vi.fn(),
  RenameProfile: vi.fn(),
}))
vi.mock('@/api', () => ({
  GetProfiles,
  SwitchProfile,
  CreateProfile,
  RenameProfile,
}))

// window.location.reload is the post-switch sweep — replace it with
// a spy so the test doesn't actually trigger a jsdom reload (which
// would tear down the wrapper before assertions complete).
const reloadSpy = vi.fn()
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { reload: reloadSpy, href: '/' },
})

import ProfileSwitcher from '@/components/ProfileSwitcher.vue'

beforeEach(() => {
  GetProfiles.mockReset()
  SwitchProfile.mockReset()
  CreateProfile.mockReset()
  RenameProfile.mockReset()
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

describe('ProfileSwitcher — rename', () => {
  it('hovering reveals a rename trigger per profile item', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    expect(wrapper.findAll('.profile-rename-trigger')).toHaveLength(2)
  })

  it('clicking the rename trigger swaps the row for an inline input pre-filled with the name', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.findAll('.profile-rename-trigger')[0]!.trigger('click')

    const form = wrapper.find('.profile-rename-form')
    expect(form.exists()).toBe(true)
    const input = wrapper.find<HTMLInputElement>('.profile-rename-input')
    expect(input.exists()).toBe(true)
    expect(input.element.value).toBe('alt')
  })

  it('submitting a valid new name fires RenameProfile and reloads', async () => {
    RenameProfile.mockResolvedValue({ active: 'jokester', profiles: ['jokester', 'main'] })
    const wrapper = await mountChip(['alt', 'main'], 'alt')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.findAll('.profile-rename-trigger')[0]!.trigger('click')

    await wrapper.find('.profile-rename-input').setValue('jokester')
    await wrapper.find('.profile-rename-form').trigger('submit')
    await flushPromises()

    expect(RenameProfile).toHaveBeenCalledWith('alt', 'jokester')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('an unchanged name disables Save (the rename is a no-op)', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.findAll('.profile-rename-trigger')[0]!.trigger('click')
    expect((wrapper.find('.profile-rename-confirm').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('an invalid name disables Save', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.findAll('.profile-rename-trigger')[0]!.trigger('click')

    await wrapper.find('.profile-rename-input').setValue('../traversal')
    expect((wrapper.find('.profile-rename-confirm').element as HTMLButtonElement).disabled).toBe(true)
    expect(RenameProfile).not.toHaveBeenCalled()
  })

  it('Cancel reverts to the row layout without firing Rename', async () => {
    const wrapper = await mountChip(['alt', 'main'], 'main')
    await wrapper.find('.profile-chip').trigger('click')
    await wrapper.findAll('.profile-rename-trigger')[0]!.trigger('click')
    await wrapper.find('.profile-rename-input').setValue('jokester')

    await wrapper.find('.profile-rename-cancel').trigger('click')
    expect(wrapper.find('.profile-rename-form').exists()).toBe(false)
    // Two actual profile rows (the "+ New profile…" button also
    // carries .profile-item, so scope to row descendants).
    expect(wrapper.findAll('.profile-item-row .profile-item')).toHaveLength(2)
    expect(RenameProfile).not.toHaveBeenCalled()
  })
})

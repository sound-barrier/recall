import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { render, screen, within } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'

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
  // The switcher is also the "whose data" control for a coaching session,
  // so its dropdown reaches the coach store — whose observers read these.
  ListCoachReturns: vi.fn(async () => []),
  GetCoachSession: vi.fn(async () => null),
  GetCoachSessionMatches: vi.fn(async () => []),
}))

// window.location.reload is the post-switch sweep — replace it with
// a spy so the test doesn't actually trigger a reload (which would
// tear down the component before assertions complete).
const reloadSpy = vi.fn()
Object.defineProperty(window, 'location', {
  configurable: true,
  value: { reload: reloadSpy, href: '/' },
})

import ProfileSwitcher from '@/components/app/masthead/ProfileSwitcher.vue'

beforeEach(() => {
  setActivePinia(createPinia())
  GetProfiles.mockReset()
  SwitchProfile.mockReset()
  CreateProfile.mockReset()
  RenameProfile.mockReset()
  reloadSpy.mockReset()
})

const user = () => userEvent.setup()

async function renderChip(profiles: string[] = ['main'], active = 'main') {
  GetProfiles.mockResolvedValue({ active, profiles })
  const view = render(ProfileSwitcher)
  await flushPromises()
  return view
}

const menu = () => screen.queryByRole('menu')
const openMenu = async (activeName = 'main') => {
  await user().click(screen.getByRole('button', { name: new RegExp(activeName) }))
}
const newTrigger = () => screen.queryByRole('menuitem', { name: 'New profile…' })
const newInput   = () => screen.queryByLabelText('New profile name')

describe('ProfileSwitcher — masthead chip', () => {
  it('renders the active profile name in the chip on mount', async () => {
    await renderChip(['main', 'alt'], 'main')
    expect(screen.getByRole('button', { name: /main/ })).toBeInTheDocument()
    // Dropdown is closed by default — no menu items rendered.
    expect(menu()).not.toBeInTheDocument()
  })

  it('clicking the chip opens the dropdown with every known profile', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    expect(menu()).toBeInTheDocument()
    const items = screen.getAllByRole('menuitem')
    // The "+ New profile…" item shares the menuitem role — slice it off.
    const names = items.slice(0, 2).map((n) => n.textContent?.trim())
    expect(names).toEqual(['alt', '✓main'])
    // The active profile is the current item in the menu.
    expect(screen.getByRole('menuitem', { name: 'main' })).toHaveAttribute('aria-current', 'true')
    expect(screen.getByRole('menuitem', { name: 'alt' })).not.toHaveAttribute('aria-current')
  })

  it('clicking a non-active profile fires SwitchProfile and reloads', async () => {
    SwitchProfile.mockResolvedValue({ active: 'alt', profiles: ['alt', 'main'] })
    await renderChip(['alt', 'main'], 'main')
    await openMenu()

    await user().click(screen.getByRole('menuitem', { name: 'alt' }))
    await flushPromises()

    expect(SwitchProfile).toHaveBeenCalledWith('alt')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('clicking the active profile is a no-op (no SwitchProfile, no reload)', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()

    await user().click(screen.getByRole('menuitem', { name: 'main' }))
    await flushPromises()

    expect(SwitchProfile).not.toHaveBeenCalled()
    expect(reloadSpy).not.toHaveBeenCalled()
  })

  it('"New profile…" opens an inline name input', async () => {
    await renderChip(['main'], 'main')
    await openMenu()
    await user().click(newTrigger()!)

    expect(newInput()).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument()
  })

  it('Create with a valid name fires CreateProfile and reloads', async () => {
    CreateProfile.mockResolvedValue({ active: 'alt', profiles: ['alt', 'main'] })
    await renderChip(['main'], 'main')
    await openMenu()
    await user().click(newTrigger()!)

    await user().type(newInput()!, 'alt')
    await user().click(screen.getByRole('button', { name: 'Create' }))
    await flushPromises()

    expect(CreateProfile).toHaveBeenCalledWith('alt')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('Create with an invalid name disables the submit button + shows the hint', async () => {
    await renderChip(['main'], 'main')
    await openMenu()
    await user().click(newTrigger()!)

    await user().type(newInput()!, '../traversal')
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled()
    expect(screen.getByText(/a–z/)).toBeInTheDocument()
  })

  it('Cancel exits the new-profile form without firing Create', async () => {
    await renderChip(['main'], 'main')
    await openMenu()
    await user().click(newTrigger()!)
    await user().type(newInput()!, 'alt')

    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(newInput()).not.toBeInTheDocument()
    expect(newTrigger()).toBeInTheDocument()
    expect(CreateProfile).not.toHaveBeenCalled()
  })
})

// A coaching session is a "whose data am I looking at" switch, which is
// exactly what this control already is — so the entry point lives here
// rather than as a seventh thing in the masthead.
describe('ProfileSwitcher — opening a player\'s bundle', () => {
  it('offers the coaching entry point in the dropdown', async () => {
    await renderChip(['main'], 'main')
    await openMenu()
    expect(screen.getByRole('menuitem', { name: /Open a player's bundle/ })).toBeInTheDocument()
  })

  it('hands the click to the coach store and closes the menu', async () => {
    const { useCoachStore } = await import('@/stores/coach')
    const openBundle = vi.spyOn(useCoachStore(), 'openBundle').mockResolvedValue(undefined)
    await renderChip(['main'], 'main')
    await openMenu()

    await user().click(screen.getByRole('menuitem', { name: /Open a player's bundle/ }))
    await flushPromises()

    expect(openBundle).toHaveBeenCalled()
    expect(menu()).not.toBeInTheDocument()
  })
})

describe('ProfileSwitcher — rename', () => {
  it('hovering reveals a rename trigger per profile item', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    expect(screen.getByLabelText('Rename profile alt')).toBeInTheDocument()
    expect(screen.getByLabelText('Rename profile main')).toBeInTheDocument()
  })

  it('clicking the rename trigger swaps the row for an inline input pre-filled with the name', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    await user().click(screen.getByLabelText('Rename profile alt'))

    expect(screen.getByLabelText('New name for profile alt')).toHaveValue('alt')
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument()
  })

  it('submitting a valid new name fires RenameProfile and reloads', async () => {
    RenameProfile.mockResolvedValue({ active: 'jokester', profiles: ['jokester', 'main'] })
    await renderChip(['alt', 'main'], 'alt')
    await openMenu('alt')
    await user().click(screen.getByLabelText('Rename profile alt'))

    const input = screen.getByLabelText('New name for profile alt')
    await user().clear(input)
    await user().type(input, 'jokester')
    await user().click(screen.getByRole('button', { name: 'Save' }))
    await flushPromises()

    expect(RenameProfile).toHaveBeenCalledWith('alt', 'jokester')
    expect(reloadSpy).toHaveBeenCalled()
  })

  it('an unchanged name disables Save (the rename is a no-op)', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    await user().click(screen.getByLabelText('Rename profile alt'))
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('an invalid name disables Save', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    await user().click(screen.getByLabelText('Rename profile alt'))

    const input = screen.getByLabelText('New name for profile alt')
    await user().clear(input)
    await user().type(input, '../traversal')
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(RenameProfile).not.toHaveBeenCalled()
  })

  it('Cancel reverts to the row layout without firing Rename', async () => {
    await renderChip(['alt', 'main'], 'main')
    await openMenu()
    await user().click(screen.getByLabelText('Rename profile alt'))
    const input = screen.getByLabelText('New name for profile alt')
    await user().clear(input)
    await user().type(input, 'jokester')

    await user().click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('New name for profile alt')).not.toBeInTheDocument()
    // Two actual profile rows, then the "+ New profile…" trigger and the
    // coaching entry point — neither of which names a profile.
    const items = screen.getAllByRole('menuitem')
    expect(items.map((i) => within(i).queryByText(/alt|main/) !== null)).toEqual([true, true, false, false])
    expect(RenameProfile).not.toHaveBeenCalled()
  })
})

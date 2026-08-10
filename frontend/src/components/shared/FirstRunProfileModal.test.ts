import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'

const { RenameProfileMock } = vi.hoisted(() => ({ RenameProfileMock: vi.fn() }))
vi.mock('@/api', () => ({
  RenameProfile: RenameProfileMock,
}))

import FirstRunProfileModal from '@/components/shared/FirstRunProfileModal.vue'
import type { NamedCandidate } from '@/api'

beforeEach(() => {
  RenameProfileMock.mockReset()
})
afterEach(() => {
  vi.clearAllMocks()
})

const CANDIDATES: NamedCandidate[] = [
  { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',                 exists: true  },
  { name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: false },
  { name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',             exists: true  },
  { name: 'steam',   label: 'Steam install',  path: '',                                                  exists: false },
]

function renderModal(overrides: Partial<{ platform: string; candidates: NamedCandidate[]; picking: boolean }> = {}) {
  return render(FirstRunProfileModal, {
    props: {
      platform:   overrides.platform   ?? 'windows',
      candidates: overrides.candidates ?? [...CANDIDATES],
      picking:    overrides.picking    ?? false,
    },
  })
}

const user = () => userEvent.setup()
const nameInput = () => screen.getByLabelText('Account name')
const nextBtn   = () => screen.getByRole('button', { name: 'Next' })
const keepBtn   = () => screen.getByRole('button', { name: 'Keep as "main"' })
const skipBtn   = () => screen.getByRole('button', { name: 'Skip — set up later' })
const step1Title = () => screen.queryByRole('heading', { name: /Main account name/ })
const step2Title = () => screen.queryByRole('heading', { name: /Where do your screenshots live\?/ })

async function advanceToPicker(view: ReturnType<typeof renderModal>) {
  await user().type(nameInput(), 'SilentStorm')
  await user().click(nextBtn())
  await flushPromises()
  return view
}

describe('FirstRunProfileModal — step 1 (name)', () => {
  it('renders the Main account name prompt + Next / Keep buttons', () => {
    renderModal()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(step1Title()).toBeInTheDocument()
    expect(nextBtn()).toBeInTheDocument()
    expect(keepBtn()).toBeInTheDocument()
  })

  it('disables Next until a valid name is typed', async () => {
    renderModal()
    expect(nextBtn()).toBeDisabled()
    await user().type(nameInput(), 'SilentStorm')
    expect(nextBtn()).toBeEnabled()
  })

  it('shows the hint and disables Next for an invalid name', async () => {
    renderModal()
    await user().type(nameInput(), '../traversal')
    expect(nextBtn()).toBeDisabled()
    expect(screen.getByText(/start with a letter or digit/)).toBeInTheDocument()
  })

  it('Next calls RenameProfile + advances to the picker step (no dismiss yet)', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const { emitted } = await advanceToPicker(renderModal())
    expect(RenameProfileMock).toHaveBeenCalledWith('main', 'SilentStorm')
    // Step 2 surfaces; modal still mounted; no dismiss yet.
    expect(step2Title()).toBeInTheDocument()
    expect(emitted('dismiss')).toBeFalsy()
  })

  it('Keep as "main" advances to the picker step (no dismiss yet)', async () => {
    const { emitted } = renderModal()
    await user().click(keepBtn())
    expect(RenameProfileMock).not.toHaveBeenCalled()
    expect(step2Title()).toBeInTheDocument()
    expect(emitted('dismiss')).toBeFalsy()
  })

  it('surfaces an error and does NOT advance when RenameProfile rejects', async () => {
    RenameProfileMock.mockRejectedValue(new Error('boom'))
    const { emitted } = await advanceToPicker(renderModal())
    expect(screen.getByRole('alert')).toHaveTextContent('boom')
    // Still on step 1; no dismiss.
    expect(step1Title()).toBeInTheDocument()
    expect(emitted('dismiss')).toBeFalsy()
  })
})

describe('FirstRunProfileModal — step 2 (picker)', () => {
  it('clicking a found source card emits pick-source + dismiss carrying the name', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const { emitted } = await advanceToPicker(renderModal())
    // Click the Nvidia card.
    await user().click(screen.getByRole('button', { name: /Nvidia Overlay/ }))
    expect(emitted('pick-source')).toBeTruthy()
    expect(emitted('pick-source')[0]).toEqual(['C:\\Users\\J\\Videos\\Overwatch'])
    expect(emitted('dismiss')).toBeTruthy()
    expect(emitted('dismiss')[0]).toEqual(['SilentStorm'])
  })

  it('Skip dismisses without firing pick-source, carrying the name through', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const { emitted } = await advanceToPicker(renderModal())
    await user().click(skipBtn())
    expect(emitted('pick-source')).toBeFalsy()
    expect(emitted('dismiss')).toEqual([['SilentStorm']])
  })

  it('Keep → Skip dismisses with null (no rename was performed)', async () => {
    const { emitted } = renderModal()
    await user().click(keepBtn())
    await user().click(skipBtn())
    expect(RenameProfileMock).not.toHaveBeenCalled()
    expect(emitted('dismiss')).toEqual([[null]])
  })

  it('Back returns to step 1 with the typed name preserved', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    await advanceToPicker(renderModal())
    await user().click(screen.getByRole('button', { name: '← Back' }))
    expect(step1Title()).toBeInTheDocument()
    expect(nameInput()).toHaveValue('SilentStorm')
  })

  it('custom-pick emits pick-custom-source without dismissing', async () => {
    const { emitted } = renderModal()
    await user().click(keepBtn())
    await user().click(screen.getByRole('button', { name: /Pick a different folder/ }))
    expect(emitted('pick-custom-source')).toBeTruthy()
    expect(emitted('dismiss')).toBeFalsy()
  })
})

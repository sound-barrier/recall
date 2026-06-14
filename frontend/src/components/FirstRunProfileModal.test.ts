import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'

const { RenameProfileMock } = vi.hoisted(() => ({ RenameProfileMock: vi.fn() }))
vi.mock('@/api', () => ({
  RenameProfile: RenameProfileMock,
}))

import FirstRunProfileModal from '@/components/FirstRunProfileModal.vue'
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

function mountModal(overrides: Partial<{ platform: string; candidates: NamedCandidate[]; picking: boolean }> = {}) {
  return mount(FirstRunProfileModal, {
    attachTo: document.body,
    props: {
      platform:   overrides.platform   ?? 'windows',
      candidates: overrides.candidates ?? [...CANDIDATES],
      picking:    overrides.picking    ?? false,
    },
  })
}

describe('FirstRunProfileModal — step 1 (name)', () => {
  it('renders the Main account name prompt + Next / Keep buttons', () => {
    const w = mountModal()
    expect(w.find('.first-run-modal').exists()).toBe(true)
    expect(w.find('.first-run-title').text()).toContain('Main account name')
    expect(w.find('[data-step-save]').exists()).toBe(true)
    expect(w.find('[data-step-keep]').exists()).toBe(true)
    expect(w.find('[data-step-save]').text()).toContain('Next')
  })

  it('disables Next until a valid name is typed', async () => {
    const w = mountModal()
    expect((w.find('[data-step-save]').element as HTMLButtonElement).disabled).toBe(true)
    await w.find('.first-run-input').setValue('SilentStorm')
    expect((w.find('[data-step-save]').element as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the hint and disables Next for an invalid name', async () => {
    const w = mountModal()
    await w.find('.first-run-input').setValue('../traversal')
    expect((w.find('[data-step-save]').element as HTMLButtonElement).disabled).toBe(true)
    expect(w.find('.first-run-hint').exists()).toBe(true)
  })

  it('Next calls RenameProfile + advances to the picker step (no dismiss yet)', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const w = mountModal()
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    expect(RenameProfileMock).toHaveBeenCalledWith('main', 'SilentStorm')
    // Step 2 surfaces; modal still mounted; no dismiss yet.
    expect(w.find('.first-run-title').text()).toContain('Where do your screenshots live?')
    expect(w.emitted('dismiss')).toBeFalsy()
  })

  it('Keep as "main" advances to the picker step (no dismiss yet)', async () => {
    const w = mountModal()
    await w.find('[data-step-keep]').trigger('click')
    expect(RenameProfileMock).not.toHaveBeenCalled()
    expect(w.find('.first-run-title').text()).toContain('Where do your screenshots live?')
    expect(w.emitted('dismiss')).toBeFalsy()
  })

  it('surfaces an error and does NOT advance when RenameProfile rejects', async () => {
    RenameProfileMock.mockRejectedValue(new Error('boom'))
    const w = mountModal()
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    expect(w.find('.first-run-error').text()).toContain('boom')
    // Still on step 1; no dismiss.
    expect(w.find('.first-run-title').text()).toContain('Main account name')
    expect(w.emitted('dismiss')).toBeFalsy()
  })
})

describe('FirstRunProfileModal — step 2 (picker)', () => {
  it('clicking a found source card emits pick-source + dismiss carrying the name', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const w = mountModal()
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    // Click the Nvidia card.
    await w.find('[data-src-name="nvidia"]').trigger('click')
    expect(w.emitted('pick-source')).toBeTruthy()
    expect(w.emitted('pick-source')![0]).toEqual(['C:\\Users\\J\\Videos\\Overwatch'])
    expect(w.emitted('dismiss')).toBeTruthy()
    expect(w.emitted('dismiss')![0]).toEqual(['SilentStorm'])
  })

  it('Skip dismisses without firing pick-source, carrying the name through', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const w = mountModal()
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    await w.find('[data-step-skip]').trigger('click')
    expect(w.emitted('pick-source')).toBeFalsy()
    expect(w.emitted('dismiss')!).toEqual([['SilentStorm']])
  })

  it('Keep → Skip dismisses with null (no rename was performed)', async () => {
    const w = mountModal()
    await w.find('[data-step-keep]').trigger('click')
    await w.find('[data-step-skip]').trigger('click')
    expect(RenameProfileMock).not.toHaveBeenCalled()
    expect(w.emitted('dismiss')!).toEqual([[null]])
  })

  it('Back returns to step 1 with the typed name preserved', async () => {
    RenameProfileMock.mockResolvedValue({ active: 'SilentStorm', profiles: ['SilentStorm'] })
    const w = mountModal()
    await w.find('.first-run-input').setValue('SilentStorm')
    await w.find('.first-run-modal-box').trigger('submit')
    await flushPromises()
    await w.find('[data-step-back]').trigger('click')
    expect(w.find('.first-run-title').text()).toContain('Main account name')
    expect((w.find('.first-run-input').element as HTMLInputElement).value).toBe('SilentStorm')
  })

  it('custom-pick emits pick-custom-source without dismissing', async () => {
    const w = mountModal()
    await w.find('[data-step-keep]').trigger('click')
    await w.find('[data-src-pick-custom]').trigger('click')
    expect(w.emitted('pick-custom-source')).toBeTruthy()
    expect(w.emitted('dismiss')).toBeFalsy()
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import UpdateCheckModal from './UpdateCheckModal.vue'
import * as api from '../api'
import type { UpdateInfo } from '../api'

const baseInfo: UpdateInfo = {
  checked: true,
  dev_build: false,
  available: true,
  latest: '1.2.3',
  url: 'https://example/v1.2.3',
  release_notes: '## 1.2.3\n\n- New hero: Phoenix\n- New map: Cascade',
  data: {
    applied_tag: '1.0.0',
    has_update: true,
    added_heroes: ['Phoenix'],
    added_maps: ['Cascade'],
  },
}

describe('UpdateCheckModal', () => {
  beforeEach(() => {
    vi.spyOn(api, 'ApplyDataUpdate').mockImplementation(async () => ({
      applied_tag: '1.2.3',
      added_heroes: ['Phoenix'],
      added_maps: ['Cascade'],
    }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both sections with current vs latest', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('Recall app')
    expect(wrapper.text()).toContain('Game data')
    expect(wrapper.text()).toContain('v1.0.0')
    expect(wrapper.text()).toContain('v1.2.3')
  })

  it('renders the release-notes excerpt', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('New hero: Phoenix')
  })

  it('lists added heroes/maps in the diff', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('+ Hero: Phoenix')
    expect(wrapper.text()).toContain('+ Map: Cascade')
  })

  it('emits applied + shows success summary after the Apply button is clicked', async () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('applied')).toHaveLength(1)
    expect(wrapper.text()).toContain('Applied')
    expect(wrapper.text()).toContain('v1.2.3')
  })

  it('shows an inline error when ApplyDataUpdate throws an ApiError', async () => {
    vi.spyOn(api, 'ApplyDataUpdate').mockRejectedValueOnce(new api.ApiError(422, 'SHA-256 mismatch'))
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('SHA-256 mismatch')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('shows the release-race hint on 409', async () => {
    vi.spyOn(api, 'ApplyDataUpdate').mockRejectedValueOnce(new api.ApiError(409, 'release moved'))
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('release moved while the modal was open')
  })

  it('renders "Reference data is current" when has_update is false', () => {
    const upToDate: UpdateInfo = {
      ...baseInfo,
      available: false,
      data: { applied_tag: '1.2.3', has_update: false },
    }
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: upToDate, currentVersion: '1.2.3', checking: false },
    })
    expect(wrapper.text()).toContain('Reference data is current')
  })

  it('does not render when open is false', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: false, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.find('.update-check-modal-box').exists()).toBe(false)
  })

  it('emits close when the × button is clicked', async () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('.update-check-modal-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

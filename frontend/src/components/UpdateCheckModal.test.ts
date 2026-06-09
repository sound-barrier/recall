import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import UpdateCheckModal from './UpdateCheckModal.vue'
import * as api from '../api'
import type { UpdateInfo } from '../api'

// Default fixture: a recall.app binary update is available AND the
// main game-data channel has a new commit with three changes (2 new
// heroes, 1 retired map). The freshness header + counts + manifest
// all derive from this shape.
const baseInfo: UpdateInfo = {
  checked: true,
  dev_build: false,
  available: true,
  latest: '1.2.3',
  url: 'https://example/v1.2.3',
  release_notes: '## 1.2.3\n\n- New hero: Phoenix\n- New map: Cascade',
  game_data: {
    commit_sha: 'def5678',
    committed_at: new Date(Date.now() - 60_000).toISOString(),  // 1 min ago
    applied_commit: 'abc1234',
    applied_at: new Date(Date.now() - 14 * 86_400_000).toISOString(),  // 14 days ago
    has_update: true,
    added_heroes: ['Phoenix', 'Sojourn'],
    removed_maps: ['Hollywood'],
  },
}

describe('UpdateCheckModal', () => {
  beforeEach(() => {
    vi.spyOn(api, 'ApplyGameDataUpdate').mockImplementation(async () => ({
      applied_commit: 'def5678',
      added_heroes: ['Phoenix', 'Sojourn'],
      removed_maps: ['Hollywood'],
    }))
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both sections with current vs latest binary version', () => {
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

  it('renders the freshness from→to line with applied + incoming commits', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    const freshness = wrapper.find('[data-update-check-freshness]')
    expect(freshness.exists()).toBe(true)
    expect(freshness.text()).toContain('MAIN @ abc1234')
    expect(freshness.text()).toContain('MAIN @ def5678')
  })

  it('renders the counts headline with added + retired counts', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    const counts = wrapper.find('[data-update-check-counts]')
    expect(counts.exists()).toBe(true)
    expect(counts.text()).toContain('2 NEW')
    expect(counts.text()).toContain('1 RETIRED')
  })

  it('renders the diff manifest with kind chips + signs + names', () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    const manifest = wrapper.find('[data-update-check-manifest]')
    expect(manifest.exists()).toBe(true)
    const rows = manifest.findAll('.update-check-modal-manifest-row')
    expect(rows).toHaveLength(3)
    expect(manifest.text()).toContain('Phoenix')
    expect(manifest.text()).toContain('Sojourn')
    expect(manifest.text()).toContain('Hollywood')
    expect(manifest.findAll('.update-check-modal-manifest-row-added')).toHaveLength(2)
    expect(manifest.findAll('.update-check-modal-manifest-row-removed')).toHaveLength(1)
  })

  it('emits applied + shows "Applied" button label after clicking Update game data', async () => {
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('applied')).toHaveLength(1)
    expect(wrapper.find('[data-update-check-apply]').text()).toContain('Applied')
  })

  it('shows an inline error when ApplyGameDataUpdate throws an ApiError', async () => {
    vi.spyOn(api, 'ApplyGameDataUpdate').mockRejectedValueOnce(new api.ApiError(422, 'SHA-256 mismatch'))
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('SHA-256 mismatch')
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('shows the "main unreachable" state when commit_sha is empty', () => {
    const unreachable: UpdateInfo = {
      ...baseInfo,
      game_data: { commit_sha: '', applied_commit: '', has_update: false },
    }
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: unreachable, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.find('[data-update-check-main-unreachable]').exists()).toBe(true)
    expect(wrapper.find('[data-update-check-apply]').exists()).toBe(false)
  })

  it('renders the "ALL CURRENT" state when has_update is false', () => {
    const upToDate: UpdateInfo = {
      ...baseInfo,
      available: false,
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'def5678',
        has_update: false,
      },
    }
    const wrapper = mount(UpdateCheckModal, {
      props: { open: true, updateInfo: upToDate, currentVersion: '1.2.3', checking: false },
    })
    expect(wrapper.text()).toContain('ALL CURRENT')
    expect(wrapper.find('[data-update-check-apply]').exists()).toBe(false)
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

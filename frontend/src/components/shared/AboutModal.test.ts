import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import AboutModal from '@/components/shared/AboutModal.vue'
import * as api from '@/api'
import type { UpdateInfo } from '@/api'

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

describe('AboutModal', () => {
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

  it('leads with the app identity: version + the unofficial-Overwatch disclaimer + project links', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('About Recall')
    expect(wrapper.find('[data-about-version]').text()).toContain('v1.0.0')
    expect(wrapper.find('[data-about-disclaimer]').text()).toMatch(/not affiliated/i)
    expect(wrapper.find('[data-about-github]').exists()).toBe(true)
    expect(wrapper.find('[data-about-license]').exists()).toBe(true)
    expect(wrapper.find('[data-about-issues]').exists()).toBe(true)
  })

  it('shows the identity + disclaimer even while the update check is still in flight', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: null, currentVersion: '1.0.0', checking: true },
    })
    expect(wrapper.find('[data-about-version]').text()).toContain('v1.0.0')
    expect(wrapper.find('[data-about-disclaimer]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Checking GitHub releases…')
  })

  it('opens the GitHub repo when the source link is clicked', async () => {
    const open = vi.spyOn(api, 'OpenURL').mockImplementation(() => {})
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-about-github]').trigger('click')
    expect(open).toHaveBeenCalledWith(expect.stringContaining('github.com/sound-barrier/recall'))
  })

  it('renders both sections with current vs latest binary version', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('Recall app')
    expect(wrapper.text()).toContain('Game data')
    expect(wrapper.text()).toContain('v1.0.0')
    expect(wrapper.text()).toContain('v1.2.3')
  })

  it('renders the release-notes excerpt', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.text()).toContain('New hero: Phoenix')
  })

  it('leads with a plain-language change summary + data age, never a commit SHA', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    // 2 added heroes, 0 added maps → "2 new heroes available".
    expect(wrapper.find('[data-update-check-summary]').text()).toContain('2 new heroes available')
    expect(wrapper.find('[data-update-check-freshness]').text()).toContain('Your roster data is 14 days old')
    // The meaningless commit SHAs are gone.
    expect(wrapper.text()).not.toContain('MAIN @')
    expect(wrapper.text()).not.toContain('abc1234')
    expect(wrapper.text()).not.toContain('def5678')
  })

  it('flags an available binary update with the latest version', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    const row = wrapper.find('[data-update-check-available]')
    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('v1.2.3')
    expect(row.text()).toContain('update available')
  })

  it('frames a dev build as ahead of the latest release, not behind it', () => {
    const devInfo: UpdateInfo = { ...baseInfo, dev_build: true, available: false }
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: devInfo, currentVersion: '1.3.0-dev', checking: false },
    })
    const dev = wrapper.find('[data-update-check-devbuild]')
    expect(dev.exists()).toBe(true)
    expect(dev.text()).toContain('Development build')
    expect(dev.text()).toContain('v1.3.0-dev')
    expect(dev.text()).toContain('Ahead of the latest release')
    expect(dev.text()).toContain('v1.2.3')
    // No misleading Current/Latest comparison on a dev build.
    expect(wrapper.find('[data-update-check-available]').exists()).toBe(false)
  })

  it('shows up-to-date copy on the latest release build', () => {
    const currentInfo: UpdateInfo = { ...baseInfo, dev_build: false, available: false }
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: currentInfo, currentVersion: '1.2.3', checking: false },
    })
    const uptodate = wrapper.find('[data-update-check-uptodate]')
    expect(uptodate.exists()).toBe(true)
    expect(uptodate.text()).toContain('latest release')
    expect(uptodate.text()).toContain('v1.2.3')
  })

  it('renders the counts headline with added + retired counts', () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    const counts = wrapper.find('[data-update-check-counts]')
    expect(counts.exists()).toBe(true)
    expect(counts.text()).toContain('2 NEW')
    expect(counts.text()).toContain('1 RETIRED')
  })

  it('renders the diff manifest with kind chips + signs + names', () => {
    const wrapper = mount(AboutModal, {
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
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('[data-update-check-apply]').trigger('click')
    await flushPromises()
    expect(wrapper.emitted('applied')).toHaveLength(1)
    expect(wrapper.find('[data-update-check-apply]').text()).toContain('Applied')
  })

  it('shows an inline error when ApplyGameDataUpdate throws an ApiError', async () => {
    vi.spyOn(api, 'ApplyGameDataUpdate').mockRejectedValueOnce(new api.ApiError(422, 'SHA-256 mismatch'))
    const wrapper = mount(AboutModal, {
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
    const wrapper = mount(AboutModal, {
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
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: upToDate, currentVersion: '1.2.3', checking: false },
    })
    expect(wrapper.text()).toContain('ALL CURRENT')
    expect(wrapper.find('[data-update-check-apply]').exists()).toBe(false)
  })

  it('does not render when open is false', () => {
    const wrapper = mount(AboutModal, {
      props: { open: false, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    expect(wrapper.find('.update-check-modal-box').exists()).toBe(false)
  })

  it('emits close when the × button is clicked', async () => {
    const wrapper = mount(AboutModal, {
      props: { open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false },
    })
    await wrapper.find('.update-check-modal-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

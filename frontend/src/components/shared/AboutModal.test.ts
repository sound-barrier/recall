import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/vue'
import userEvent from '@testing-library/user-event'
import { flushPromises } from '@/test-utils'
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
  can_self_update: false,
}

interface ModalProps {
  open: boolean
  updateInfo: UpdateInfo | null
  currentVersion: string
  checking: boolean
  selfUpdate?: { phase: 'idle' | 'downloading' | 'ready' | 'error'; pct: number | null; error: string }
}

function renderModal(props: ModalProps) {
  return render(AboutModal, { props })
}

const user = () => userEvent.setup()
const dialog = () => screen.queryByRole('dialog')
const applyBtn = () => screen.queryByRole('button', { name: /Update game data|Applying|Applied/ })
const installBtn = () => screen.queryByRole('button', { name: /Install update|Try again/ })

// The About surface repeats version strings and freshness copy across
// its sections; the data-* regions it shares with the e2e specs are the
// stable scoping for those assertions.
/* eslint-disable testing-library/no-node-access -- e2e-shared data-* regions scope copy that repeats across sections */
const region = (base: Element, sel: string) => base.querySelector(sel)
/* eslint-enable testing-library/no-node-access */

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
    const { baseElement } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(screen.getByText(/About Recall/)).toBeInTheDocument()
    expect(region(baseElement, '[data-about-version]')).toHaveTextContent('v1.0.0')
    expect(region(baseElement, '[data-about-disclaimer]')).toHaveTextContent(/not affiliated/i)
    expect(screen.getByRole('button', { name: /Source on GitHub/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /License/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /issue/i })).toBeInTheDocument()
  })

  it('shows the identity + disclaimer even while the update check is still in flight', () => {
    const { baseElement } = renderModal({ open: true, updateInfo: null, currentVersion: '1.0.0', checking: true })
    expect(region(baseElement, '[data-about-version]')).toHaveTextContent('v1.0.0')
    expect(region(baseElement, '[data-about-disclaimer]')).toBeInTheDocument()
    expect(screen.getByText(/Checking GitHub releases…/)).toBeInTheDocument()
  })

  it('opens the GitHub repo when the source link is clicked', async () => {
    const open = vi.spyOn(api, 'OpenURL').mockImplementation(() => {})
    renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    await user().click(screen.getByRole('button', { name: /Source on GitHub/ }))
    expect(open).toHaveBeenCalledWith(expect.stringContaining('github.com/sound-barrier/recall'))
  })

  it('renders both sections with current vs latest binary version', () => {
    renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(screen.getByText('Recall app')).toBeInTheDocument()
    expect(screen.getByText('Game data')).toBeInTheDocument()
    expect(screen.getAllByText(/v1\.0\.0/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/v1\.2\.3/).length).toBeGreaterThan(0)
  })

  it('renders the release-notes excerpt', () => {
    renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(screen.getByText(/New hero: Phoenix/)).toBeInTheDocument()
  })

  it('leads with a plain-language change summary, never a commit SHA', () => {
    const { baseElement } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    // 2 added heroes, 0 added maps → "2 new heroes available".
    expect(region(baseElement, '[data-update-check-summary]')).toHaveTextContent('2 new heroes available')
    // The meaningless commit SHAs are gone.
    expect(screen.queryByText(/MAIN @/)).not.toBeInTheDocument()
    expect(screen.queryByText(/abc1234/)).not.toBeInTheDocument()
    expect(screen.queryByText(/def5678/)).not.toBeInTheDocument()
  })

  // The freshness line reports CONTENT, not age: when nothing has changed it must
  // say the roster is up to date, never "N days old" — no roster released ≠ stale.
  it('says the roster is up to date (not "N days old") when nothing has changed', () => {
    const upToDate: UpdateInfo = {
      ...baseInfo,
      available: false,
      game_data: {
        commit_sha: 'def5678',
        committed_at: new Date(Date.now() - 16 * 86_400_000).toISOString(),
        applied_commit: 'abc1234',
        applied_at: new Date(Date.now() - 16 * 86_400_000).toISOString(), // applied 16 days ago
        has_update: false, // rosters match the live channel — no diff
      },
    }
    const { baseElement } = renderModal({ open: true, updateInfo: upToDate, currentVersion: '1.0.0', checking: false })
    const freshness = region(baseElement, '[data-update-check-freshness]')
    expect(freshness).toHaveTextContent('up to date')
    expect(freshness).not.toHaveTextContent(/days? old/)
  })

  it('flags an available binary update with the latest version', () => {
    const { baseElement } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    const row = region(baseElement, '[data-update-check-available]')
    expect(row).toHaveTextContent('v1.2.3')
    expect(row).toHaveTextContent('update available')
  })

  it('frames a dev build as ahead of the latest release, not behind it', () => {
    const devInfo: UpdateInfo = { ...baseInfo, dev_build: true, available: false }
    const { baseElement } = renderModal({ open: true, updateInfo: devInfo, currentVersion: '1.3.0-dev', checking: false })
    const dev = region(baseElement, '[data-update-check-devbuild]')
    expect(dev).toHaveTextContent('Development build')
    expect(dev).toHaveTextContent('v1.3.0-dev')
    expect(dev).toHaveTextContent('Ahead of the latest release')
    expect(dev).toHaveTextContent('v1.2.3')
    // No misleading Current/Latest comparison on a dev build.
    expect(region(baseElement, '[data-update-check-available]')).toBeNull()
  })

  it('shows up-to-date copy on the latest release build', () => {
    const currentInfo: UpdateInfo = { ...baseInfo, dev_build: false, available: false }
    const { baseElement } = renderModal({ open: true, updateInfo: currentInfo, currentVersion: '1.2.3', checking: false })
    const uptodate = region(baseElement, '[data-update-check-uptodate]')
    expect(uptodate).toHaveTextContent('latest release')
    expect(uptodate).toHaveTextContent('v1.2.3')
  })

  it('renders the counts headline with added + retired counts', () => {
    renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(screen.getByText(/2 NEW/)).toBeInTheDocument()
    expect(screen.getByText(/1 RETIRED/)).toBeInTheDocument()
  })

  it('renders the diff manifest with kind chips + signs + names', () => {
    const { baseElement } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(screen.getByText('Phoenix')).toBeInTheDocument()
    expect(screen.getByText('Sojourn')).toBeInTheDocument()
    expect(screen.getByText('Hollywood')).toBeInTheDocument()
    // Row tint classes (added/removed) are the only expression of the
    // change kind beyond the sign glyphs.
    /* eslint-disable testing-library/no-node-access -- added/removed row tint classes have no accessible equivalent */
    const manifest = region(baseElement, '[data-update-check-manifest]')!
    expect(manifest.querySelectorAll('.update-check-modal-manifest-row')).toHaveLength(3)
    expect(manifest.querySelectorAll('.update-check-modal-manifest-row-added')).toHaveLength(2)
    expect(manifest.querySelectorAll('.update-check-modal-manifest-row-removed')).toHaveLength(1)
    /* eslint-enable testing-library/no-node-access */
  })

  it('emits applied + shows "Applied" button label after clicking Update game data', async () => {
    const { emitted } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    await user().click(applyBtn()!)
    await flushPromises()
    expect(emitted('applied')).toHaveLength(1)
    expect(applyBtn()).toHaveTextContent('Applied')
  })

  it('shows an inline error when ApplyGameDataUpdate throws an ApiError', async () => {
    vi.spyOn(api, 'ApplyGameDataUpdate').mockRejectedValueOnce(new api.ApiError(422, 'SHA-256 mismatch'))
    renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    await user().click(applyBtn()!)
    await flushPromises()
    expect(screen.getByRole('alert')).toHaveTextContent('SHA-256 mismatch')
  })

  it('shows the "main unreachable" state when commit_sha is empty', () => {
    const unreachable: UpdateInfo = {
      ...baseInfo,
      game_data: { commit_sha: '', applied_commit: '', has_update: false },
    }
    const { baseElement } = renderModal({ open: true, updateInfo: unreachable, currentVersion: '1.0.0', checking: false })
    expect(region(baseElement, '[data-update-check-main-unreachable]')).toBeInTheDocument()
    expect(applyBtn()).not.toBeInTheDocument()
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
    renderModal({ open: true, updateInfo: upToDate, currentVersion: '1.2.3', checking: false })
    expect(screen.getByText(/ALL CURRENT/)).toBeInTheDocument()
    expect(applyBtn()).not.toBeInTheDocument()
  })

  it('does not render when open is false', () => {
    renderModal({ open: false, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    expect(dialog()).not.toBeInTheDocument()
  })

  it('emits close when the × button is clicked', async () => {
    const { emitted } = renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false })
    await user().click(screen.getByRole('button', { name: 'Close about' }))
    expect(emitted('close')).toHaveLength(1)
  })

  describe('in-app self-update CTAs', () => {
    // can_self_update true: an install that can swap its own binary.
    const selfUpdatable: UpdateInfo = { ...baseInfo, can_self_update: true }
    const idle = { phase: 'idle' as const, pct: null, error: '' }

    it('shows Install update only when can_self_update is true', () => {
      renderModal({ open: true, updateInfo: selfUpdatable, currentVersion: '1.0.0', checking: false, selfUpdate: idle })
      expect(installBtn()).toBeInTheDocument()
    })

    it('hides Install update when can_self_update is false, keeping the release-page fallback', () => {
      renderModal({ open: true, updateInfo: baseInfo, currentVersion: '1.0.0', checking: false, selfUpdate: idle })
      expect(installBtn()).not.toBeInTheDocument()
      // The release-page fallback is present regardless.
      expect(screen.getByRole('button', { name: /Open release page/ })).toBeInTheDocument()
    })

    it('emits install when Install update is clicked', async () => {
      const { emitted } = renderModal({ open: true, updateInfo: selfUpdatable, currentVersion: '1.0.0', checking: false, selfUpdate: idle })
      await user().click(installBtn()!)
      expect(emitted('install')).toHaveLength(1)
    })

    it('replaces the button with a progressbar while a download is in flight', () => {
      renderModal({
        open: true, updateInfo: selfUpdatable, currentVersion: '1.0.0', checking: false,
        selfUpdate: { phase: 'downloading', pct: 42, error: '' },
      })
      const bar = screen.getByRole('progressbar')
      expect(bar).toHaveAttribute('aria-valuenow', '42')
      expect(bar).toHaveTextContent('42%')
      // The install button is gone while busy.
      expect(installBtn()).not.toBeInTheDocument()
    })

    it('offers Restart now once the update is staged', async () => {
      const { emitted } = renderModal({
        open: true, updateInfo: selfUpdatable, currentVersion: '1.0.0', checking: false,
        selfUpdate: { phase: 'ready', pct: 100, error: '' },
      })
      await user().click(screen.getByRole('button', { name: /Restart now/ }))
      expect(emitted('restart')).toHaveLength(1)
    })

    it('shows an alert and a retry affordance in the error phase', () => {
      renderModal({
        open: true, updateInfo: selfUpdatable, currentVersion: '1.0.0', checking: false,
        selfUpdate: { phase: 'error', pct: null, error: 'checksum mismatch' },
      })
      expect(screen.getByRole('alert')).toHaveTextContent('checksum mismatch')
      // The Install control returns (labeled as a retry) so the user can retry.
      expect(installBtn()).toHaveTextContent('Try again')
    })
  })
})

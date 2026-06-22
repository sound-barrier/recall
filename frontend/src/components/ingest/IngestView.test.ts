import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import IngestView from '@/components/ingest/IngestView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import type { MatchRecord, TesseractStatus } from '@/api'

// IngestView reads its state from the stores now (settings: Tesseract + watch;
// matches: the parse stream + counts; app: tab nav). These tests seed the
// stores + spy on the actions the buttons drive, rather than passing props /
// asserting emits. The store mounts the matches store, which statically imports
// '@/api'; keep the module real except GetMatchResults (so the boot reload
// doesn't hit the transport). e2e covers the full parse transport chain.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults: vi.fn(async () => []),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

function tess(found: boolean): TesseractStatus {
  return { path: '/t', found, version: '5.5.0', supported: true, error: '', default: '/t', platform: 'darwin' }
}

function rec(i: number): MatchRecord {
  return { match_key: `m-${i}`, source_files: [], data: { map: 'rialto', date: '2026-05-10' } }
}

interface IngestOver {
  tesseractReady?:     boolean
  screenshotsDir?:     string
  watchEnabled?:       boolean
  parseBusy?:          boolean
  cancellingParse?:    boolean
  newScreenshotCount?: number | null
  lastParsedAt?:       number | null
  matchedCount?:       number
}

function mountIngest(over: IngestOver = {}) {
  setActivePinia(createPinia())
  const app = useAppStore()
  const matches = useMatchesStore()
  const settings = useSettingsStore()

  settings.setTesseractStatus(tess(over.tesseractReady ?? true))
  settings.setScreenshotsDir(over.screenshotsDir ?? '/srv/recall')
  settings.setWatchEnabled(over.watchEnabled ?? false)

  matches.parseBusy = over.parseBusy ?? false
  matches.cancellingParse = over.cancellingParse ?? false
  matches.newScreenshotCount = over.newScreenshotCount ?? 3
  matches.lastParsedAt = over.lastParsedAt ?? null
  matches.records = Array.from({ length: over.matchedCount ?? 0 }, (_, i) => rec(i))

  // Spy on the actions the buttons drive (before mount so IngestView's
  // destructure captures the spies) — avoids the real parse pipeline / api.
  const spies = {
    parse:         vi.spyOn(matches, 'parse').mockResolvedValue(undefined),
    onCancelParse: vi.spyOn(matches, 'onCancelParse').mockResolvedValue(undefined),
    toggleWatch:   vi.spyOn(settings, 'toggleWatch').mockResolvedValue(undefined),
  }

  const wrapper = mount(IngestView)
  return { wrapper, app, matches, settings, spies }
}

describe('IngestView (Parse tab)', () => {
  it('shows the readiness checklist with Tesseract outstanding when not ready', () => {
    const { wrapper } = mountIngest({ tesseractReady: false })
    expect(wrapper.find('[data-readiness-checklist]').exists()).toBe(true)
    const tess = wrapper.find('[data-readiness-item="tesseract"]')
    expect(tess.classes()).not.toContain('done')
    expect(tess.text()).toContain('Settings → Engine')
    // The folder prerequisite (default dir) is already satisfied.
    expect(wrapper.find('[data-readiness-item="folder"]').classes()).toContain('done')
  })

  it('shows the readiness checklist with the folder outstanding when no dir is set', () => {
    const { wrapper } = mountIngest({ screenshotsDir: '' })
    expect(wrapper.find('[data-readiness-checklist]').exists()).toBe(true)
    const folder = wrapper.find('[data-readiness-item="folder"]')
    expect(folder.classes()).not.toContain('done')
    expect(folder.text()).toContain('Settings → Folders')
    expect(wrapper.find('[data-readiness-item="tesseract"]').classes()).toContain('done')
  })

  it('hides the checklist once both prerequisites are satisfied', () => {
    const { wrapper } = mountIngest()
    expect(wrapper.find('[data-readiness-checklist]').exists()).toBe(false)
  })

  it('renders the "Ready to parse" heading on a clean install', () => {
    const { wrapper } = mountIngest()
    expect(wrapper.text()).toContain('Ready to parse')
  })

  it('shows the matched-count heading after parses exist', () => {
    const { wrapper } = mountIngest({ matchedCount: 42 })
    expect(wrapper.text()).toContain('42 matches')
  })

  it('shows the "Watching" heading when watch is armed', () => {
    const { wrapper } = mountIngest({ watchEnabled: true })
    expect(wrapper.text()).toContain('Watching')
  })

  it('Run Parse button drives the matches-store parse action on click', async () => {
    const { wrapper, spies } = mountIngest({ newScreenshotCount: 5 })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Run Parse'))!
    await btn.trigger('click')
    expect(spies.parse).toHaveBeenCalled()
  })

  it('Run Parse button is disabled with "All parsed" copy when newScreenshotCount is 0', () => {
    const { wrapper } = mountIngest({ newScreenshotCount: 0 })
    const btn = wrapper.findAll('button').find(b => b.text().includes('All parsed'))!
    expect(btn.attributes('disabled')).toBeDefined()
    expect(btn.text()).toContain('nothing new')
    expect(btn.classes()).toContain('ghost')
  })

  it('toggles watch via the settings store on the Watch Folder checkbox change', async () => {
    const { wrapper, spies } = mountIngest()
    await wrapper.find('input[type="checkbox"]').trigger('change')
    expect(spies.toggleWatch).toHaveBeenCalled()
  })

  it('navigates to settings when the Settings link is clicked', async () => {
    const { wrapper, app } = mountIngest({ screenshotsDir: '' })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Settings'))!
    await link.trigger('click')
    expect(app.view).toBe('settings')
  })

  it('disables Watch Folder while Tesseract is unavailable, and offers a Settings shortcut', async () => {
    const { wrapper, app } = mountIngest({ tesseractReady: false })
    const cb = wrapper.find('input[type="checkbox"]')
    expect((cb.element as HTMLInputElement).disabled).toBe(true)
    const fix = wrapper.findAll('.empty-link').find(el => el.text().includes('Fix in Settings'))!
    expect(fix).toBeDefined()
    await fix.trigger('click')
    expect(app.view).toBe('settings')
  })

  it('renders only the Parse section — no Engine / Export / Data sections', () => {
    const { wrapper } = mountIngest()
    const sections = wrapper.findAll('.settings-section')
    expect(sections).toHaveLength(1)
    expect(wrapper.text()).not.toContain('Engine')
    expect(wrapper.text()).not.toContain('Export Data')
    expect(wrapper.text()).not.toContain('Clear Database')
  })
})

describe('IngestView — Stop Parse button', () => {
  it('renders Run Parse when not busy; no Stop button in the DOM', () => {
    const { wrapper } = mountIngest({ parseBusy: false })
    expect(wrapper.find('[data-testid="cancel-parse-btn"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Run Parse')
  })

  it('renders Stop Parse when parseBusy and not yet cancelling', () => {
    const { wrapper } = mountIngest({ parseBusy: true })
    const stop = wrapper.find('[data-testid="cancel-parse-btn"]')
    expect(stop.exists()).toBe(true)
    expect(stop.text()).toContain('Stop Parse')
    expect((stop.element as HTMLButtonElement).disabled).toBe(false)
  })

  it('renders Cancelling… + disables itself when cancellingParse is true', () => {
    const { wrapper } = mountIngest({ parseBusy: true, cancellingParse: true })
    const stop = wrapper.find('[data-testid="cancel-parse-btn"]')
    expect(stop.exists()).toBe(true)
    expect(stop.text()).toContain('Cancelling…')
    expect((stop.element as HTMLButtonElement).disabled).toBe(true)
  })

  it('click on the Stop button drives the cancel-parse action', async () => {
    const { wrapper, spies } = mountIngest({ parseBusy: true })
    await wrapper.find('[data-testid="cancel-parse-btn"]').trigger('click')
    expect(spies.onCancelParse).toHaveBeenCalledTimes(1)
  })
})

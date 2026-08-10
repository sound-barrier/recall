import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/vue'
import { createPinia, setActivePinia } from 'pinia'

import IngestView from '@/components/ingest/IngestView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'
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
  cancelingParse?:    boolean
  newScreenshotCount?: number | null
  lastParsedAt?:       number | null
  matchedCount?:       number
}

function renderIngest(over: IngestOver = {}) {
  setActivePinia(createPinia())
  const app = useAppStore()
  const matches = useMatchesStore()
  const settings = useSettingsStore()

  settings.setTesseractStatus(tess(over.tesseractReady ?? true))
  settings.setScreenshotsDir(over.screenshotsDir ?? '/srv/recall')
  settings.setWatchEnabled(over.watchEnabled ?? false)

  matches.parseBusy = over.parseBusy ?? false
  matches.cancelingParse = over.cancelingParse ?? false
  seedQuery(qk.pendingCount, over.newScreenshotCount ?? 3)
  matches.lastParsedAt = over.lastParsedAt ?? null
  matches.records = Array.from({ length: over.matchedCount ?? 0 }, (_, i) => rec(i))

  // Spy on the actions the buttons drive (before render so IngestView's
  // destructure captures the spies) — avoids the real parse pipeline / api.
  const spies = {
    parse:         vi.spyOn(matches, 'parse').mockResolvedValue(undefined),
    onCancelParse: vi.spyOn(matches, 'onCancelParse').mockResolvedValue(undefined),
    toggleWatch:   vi.spyOn(settings, 'toggleWatch').mockResolvedValue(undefined),
  }

  const view = render(IngestView)
  return { view, app, matches, settings, spies }
}

// NOTE: interactions in this view use TL fireEvent, not user-event —
// user-event's awaited event chain silently drops its dispatches here
// (the pending-count query notify re-renders between its queued
// events under happy-dom). fireEvent is the sanctioned fallback and
// matches the original trigger('click') semantics exactly.
const checklistHeading = () => screen.queryByRole('heading', { name: 'Two things before you can parse' })
// The outstanding-vs-done state reads through the fix-it link: an
// outstanding prerequisite renders its "Settings → …" button, a done
// one replaces it with the located/It's-set copy.
const tesseractFix = () => screen.queryByRole('button', { name: /Settings → Engine/ })
const folderFix    = () => screen.queryByRole('button', { name: /Settings → Folders/ })
const stopBtn      = () => screen.queryByRole('button', { name: /Stop Parse|Canceling…/ })

describe('IngestView (Parse tab)', () => {
  it('shows the readiness checklist with Tesseract outstanding when not ready', () => {
    renderIngest({ tesseractReady: false })
    expect(checklistHeading()).toBeInTheDocument()
    expect(tesseractFix()).toBeInTheDocument()
    // The folder prerequisite (default dir) is already satisfied.
    expect(folderFix()).not.toBeInTheDocument()
  })

  it('shows the readiness checklist with the folder outstanding when no dir is set', () => {
    renderIngest({ screenshotsDir: '' })
    expect(checklistHeading()).toBeInTheDocument()
    expect(folderFix()).toBeInTheDocument()
    expect(tesseractFix()).not.toBeInTheDocument()
  })

  it('hides the checklist once both prerequisites are satisfied', () => {
    renderIngest()
    expect(checklistHeading()).not.toBeInTheDocument()
  })

  it('renders the "Ready to parse" heading on a clean install', () => {
    renderIngest()
    expect(screen.getByText(/Ready to parse/)).toBeInTheDocument()
  })

  it('shows the matched-count heading after parses exist', () => {
    renderIngest({ matchedCount: 42 })
    expect(screen.getByText(/42 matches/)).toBeInTheDocument()
  })

  it('shows the "Watching" heading when watch is armed', () => {
    renderIngest({ watchEnabled: true })
    expect(screen.getByText(/Watching/)).toBeInTheDocument()
  })

  it('Run Parse button drives the matches-store parse action on click', async () => {
    const { spies } = renderIngest({ newScreenshotCount: 5 })
    await fireEvent.click(screen.getByRole('button', { name: /Run Parse/ }))
    expect(spies.parse).toHaveBeenCalled()
  })

  it('Run Parse button is disabled with "All parsed" copy when newScreenshotCount is 0', () => {
    renderIngest({ newScreenshotCount: 0 })
    const btn = screen.getByRole('button', { name: /All parsed/ })
    expect(btn).toBeDisabled()
    expect(btn).toHaveTextContent('nothing new')
  })

  it('toggles watch via the settings store on the Watch Folder checkbox change', async () => {
    const { spies } = renderIngest()
    await fireEvent.change(screen.getByRole('checkbox'))
    expect(spies.toggleWatch).toHaveBeenCalled()
  })

  it('navigates to settings when the Settings link is clicked', async () => {
    const { app } = renderIngest({ screenshotsDir: '' })
    await fireEvent.click(folderFix()!)
    expect(app.view).toBe('settings')
  })

  it('disables Watch Folder while Tesseract is unavailable, and offers a Settings shortcut', async () => {
    const { app } = renderIngest({ tesseractReady: false })
    expect(screen.getByRole('checkbox')).toBeDisabled()
    const fix = screen.getAllByRole('button', { name: /Fix in Settings/ })[0]!
    await fireEvent.click(fix)
    expect(app.view).toBe('settings')
  })

  it('renders only the Parse section — no Engine / Export / Data sections', () => {
    renderIngest()
    // Every settings section is titled by exactly one level-3 heading, so
    // the heading outline IS the section count: an Engine / Export / Data
    // section returning here would show up as a second one.
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 3, name: 'Parse' })).toBeInTheDocument()
    expect(screen.queryByText(/Engine/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Export Data/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Clear Database/)).not.toBeInTheDocument()
  })
})

describe('IngestView — Stop Parse button', () => {
  it('renders Run Parse when not busy; no Stop button in the DOM', () => {
    renderIngest({ parseBusy: false })
    expect(stopBtn()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Run Parse/ })).toBeInTheDocument()
  })

  it('renders Stop Parse when parseBusy and not yet canceling', () => {
    renderIngest({ parseBusy: true })
    const stop = stopBtn()
    expect(stop).toHaveTextContent('Stop Parse')
    expect(stop).toBeEnabled()
  })

  it('renders Canceling… + disables itself when cancelingParse is true', () => {
    renderIngest({ parseBusy: true, cancelingParse: true })
    const stop = stopBtn()
    expect(stop).toHaveTextContent('Canceling…')
    expect(stop).toBeDisabled()
  })

  it('click on the Stop button drives the cancel-parse action', async () => {
    const { spies } = renderIngest({ parseBusy: true })
    await fireEvent.click(stopBtn()!)
    expect(spies.onCancelParse).toHaveBeenCalledTimes(1)
  })
})

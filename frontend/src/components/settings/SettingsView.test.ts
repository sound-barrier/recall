import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/vue'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import SettingsView from '@/components/settings/SettingsView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import type { ThemeMode } from '@/composables/settings/useTheme'
import type { WeekStart } from '@/composables/shared/useWeekStart'
import type { MatchRecord, TesseractStatus, DataLocation, NamedCandidate } from '@/api'
import { qk } from '@/queries/keys'
import { seedQuery } from '@/test-utils/queryTestUtils'

// SettingsView reads everything from the stores now + distributes to its
// sub-section components, so these tests seed the stores (the same shape the
// old props had) + spy on the actions the buttons drive, instead of passing
// props + asserting emits. The store mounts the matches store (statically
// imports '@/api'); keep it real except GetMatchResults (so the boot reload
// doesn't hit the transport). e2e covers the full settings transport chain.
vi.mock('@/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api')>()),
  GetMatchResults: vi.fn(async () => []),
}))

afterEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})

function defaultTess(o: Partial<TesseractStatus> = {}): TesseractStatus {
  return { path: '/t', found: true, version: '5.5.0', supported: true, error: '', default: '/t', platform: 'darwin', ...o }
}

function makeRecords(matched: number, unknown: number): MatchRecord[] {
  const recs: MatchRecord[] = []
  for (let i = 0; i < matched; i++) recs.push({ match_key: `m-${i}`, source_files: [], data: { map: 'rialto', date: '2026-05-10' } })
  for (let i = 0; i < unknown; i++) recs.push({ match_key: `u-${i}`, source_files: [`u-${i}.png`], data: {} })
  return recs
}

interface SettingsOver {
  screenshotsDir?:       string
  parseBusy?:            boolean
  themeMode?:            ThemeMode
  weekStart?:            WeekStart
  dataLocation?:         DataLocation | null
  probing?:              boolean
  probeMessage?:         string
  probeStatus?:          '' | 'success' | 'blocked'
  probeTried?:           string[]
  screenshotCandidates?: NamedCandidate[]
  platform?:             string
  tesseractReady?:       boolean
  tesseractSupported?:   boolean
  tesseractStatus?:      TesseractStatus
  tesseractPickerBusy?:  boolean
  matchedCount?:         number
  unknownCount?:         number
  backingUp?:            boolean
  restoring?:            boolean
  restoreArmed?:         boolean
  importingMatches?:     boolean
  backupStatus?:         { ok: boolean; message: string } | null
  clearConfirm?:         boolean
  clearingDB?:           boolean
  ignoredCount?:         number
}

// The seed values every render starts from; a test's `props` override wins via
// spread merge. Array-valued seeds stay out of the base (fresh instances are
// built per render) so no mutable fixture is shared across tests.
const SETTINGS_BASE = {
  screenshotsDir:      '/srv/recall',
  parseBusy:           false,
  themeMode:           'dark' as ThemeMode,
  weekStart:           0 as WeekStart,
  dataLocation:        null as DataLocation | null,
  probing:             false,
  probeMessage:        '',
  probeStatus:         '' as '' | 'success' | 'blocked',
  platform:            'darwin',
  tesseractReady:      true,
  tesseractSupported:  true,
  tesseractPickerBusy: false,
  matchedCount:        0,
  unknownCount:        0,
  backingUp:           false,
  restoring:           false,
  restoreArmed:        false,
  importingMatches:    false,
  backupStatus:        null as { ok: boolean; message: string } | null,
  clearConfirm:        false,
  clearingDB:          false,
}

// Seeds the three stores from the old prop shape (theme/week-start are seeded
// via the real setters BEFORE the spies are installed so the seed isn't counted
// as a click), then spies on every action a sub-section button drives.
function renderSettings(opts: { props?: SettingsOver } = {}) {
  const over = { ...SETTINGS_BASE, ...opts.props }
  setActivePinia(createPinia())
  const app = useAppStore()
  const matches = useMatchesStore()
  const settings = useSettingsStore()

  settings.setTesseractStatus(over.tesseractStatus ?? defaultTess({
    found:     over.tesseractReady,
    supported: over.tesseractSupported,
    platform:  over.platform,
  }))
  settings.setScreenshotsDir(over.screenshotsDir)
  settings.setTheme(over.themeMode)
  settings.setWeekStart(over.weekStart)
  seedQuery(qk.candidates, over.screenshotCandidates ?? [])
  settings.probing = over.probing
  settings.probeMessage = over.probeMessage
  settings.probeStatus = over.probeStatus
  settings.probeTried = over.probeTried ?? []
  settings.tesseractPickerBusy = over.tesseractPickerBusy

  matches.parseBusy = over.parseBusy
  matches.backingUp = over.backingUp
  matches.restoring = over.restoring
  matches.restoreArmed = over.restoreArmed
  matches.importingMatches = over.importingMatches
  matches.backupStatus = over.backupStatus
  matches.clearConfirm = over.clearConfirm
  matches.clearingDB = over.clearingDB
  matches.records = makeRecords(over.matchedCount, over.unknownCount)
  if (over.ignoredCount != null) {
    matches.ignoredScreenshots = Array.from({ length: over.ignoredCount }, (_, i) => ({ filename: `ig-${i}.png`, ignored_at: '2026-05-10T00:00:00Z' }))
  }

  seedQuery(qk.system.dataLocation, over.dataLocation)

  const spies = {
    pickDir:               vi.spyOn(settings, 'pickDir').mockResolvedValue(undefined),
    detectDir:             vi.spyOn(settings, 'detectDir').mockResolvedValue(undefined),
    revealDir:             vi.spyOn(settings, 'revealDir').mockResolvedValue(undefined),
    resetDir:              vi.spyOn(settings, 'resetDir').mockResolvedValue(undefined),
    setTheme:              vi.spyOn(settings, 'setTheme'),
    setWeekStart:          vi.spyOn(settings, 'setWeekStart'),
    pickTesseractBinary:   vi.spyOn(settings, 'pickTesseractBinary').mockResolvedValue(undefined),
    resetTesseractPath:    vi.spyOn(settings, 'resetTesseractPath').mockResolvedValue(undefined),
    detectTesseractBinary: vi.spyOn(settings, 'detectTesseractBinary').mockResolvedValue(undefined),
    pickDetectedSource:    vi.spyOn(settings, 'pickDetectedSource').mockResolvedValue(undefined),
    backup:                vi.spyOn(matches, 'backup').mockResolvedValue(undefined),
    armRestore:            vi.spyOn(matches, 'armRestore'),
    cancelRestore:         vi.spyOn(matches, 'cancelRestore'),
    restore:               vi.spyOn(matches, 'restore').mockResolvedValue(undefined),
    importMatches:         vi.spyOn(matches, 'importMatches').mockResolvedValue(undefined),
    armClear:              vi.spyOn(matches, 'armClear'),
    cancelClear:           vi.spyOn(matches, 'cancelClear'),
    onClearDatabase:       vi.spyOn(matches, 'onClearDatabase').mockResolvedValue(undefined),
  }

  const view = render(SettingsView)
  return { view, app, matches, settings, spies }
}

// Interactions use TL fireEvent (matching the original trigger()
// dispatch — the query-notify interleaving that trips user-event's
// awaited chains applies to this store-backed view too).
const button = (name: string | RegExp) => screen.getByRole('button', { name })

// ── Structural helpers ───────────────────────────────────────────────
// Section scoping (#sec-engine — two Detect/Reset pairs exist on the
// page), status tint classes, and the probe chip are only expressed
// through the scoped classes the e2e suite shares.
/* eslint-disable testing-library/no-node-access -- section scoping + status tint classes have no accessible-name equivalent */
const engineSection = () => document.querySelector('#sec-engine') as HTMLElement
const engineStatus  = () => document.querySelector('.engine-status')
const engineRow     = () => document.querySelector('.engine-row')
const engineDesc    = () => document.querySelector('.engine-row .setting-desc')
const probeChip     = () => document.querySelector('.probe-chip')
const dataLocGrid   = () => document.querySelector('.data-loc-grid')
const dataLocActions = () => [...document.querySelectorAll('.data-loc-actions')] as HTMLElement[]
const settingValue  = () => document.querySelector('.setting-value')
/* eslint-enable testing-library/no-node-access */

const engineButton = (text: string) =>
  within(engineSection()).getAllByRole('button').find((b) => b.textContent?.trim() === text)

describe('SettingsView', () => {
  it('shows the empty-state hero when no folder is selected', () => {
    renderSettings({
      props: { screenshotsDir: '', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(screen.getByText(/Choose a/)).toBeInTheDocument()
    expect(screen.getAllByText(/screenshots folder/).length).toBeGreaterThan(0)
    // The empty-state hero card owns the primary affordance (the picker).
    expect(screen.getByRole('button', { name: /Pick a different folder/ })).toBeInTheDocument()
    // No setting-value chip should render — the row is hidden in the
    // empty state because the hero owns the CTA.
    expect(settingValue()).toBeNull()
  })

  it('shows the "where Recall reads from" heading once a folder is configured', () => {
    renderSettings({
      props: { screenshotsDir: '/srv/recall', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(screen.getByText(/Where Recall reads from/)).toBeInTheDocument()
    expect(screen.getByText('/srv/recall')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Pick a different folder/ })).not.toBeInTheDocument()
  })

  it('emits pick-screenshots-dir when the Change… button is clicked', async () => {
    const { spies } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await fireEvent.click(button('Change…'))
    expect(spies.pickDir).toHaveBeenCalled()
  })

  it('disables the Change… button while parseBusy=true', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: true, themeMode: 'dark', weekStart: 0 },
    })
    expect(button('Change…')).toBeDisabled()
  })

  it('emits set-theme with the picked mode when a swatch is clicked', async () => {
    const { spies } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await fireEvent.click(screen.getByRole('radio', { name: /Day/ }))
    expect(spies.setTheme).toHaveBeenCalled()
    expect(spies.setTheme).toHaveBeenCalledWith('day')
  })

  it('emits set-theme with "high-contrast" when the Contrast swatch is clicked', async () => {
    const { spies } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await fireEvent.click(screen.getByRole('radio', { name: /High contrast/ }))
    expect(spies.setTheme).toHaveBeenCalledWith('high-contrast')
  })

  it('marks the active theme swatch per themeMode (dark)', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(screen.getByRole('radio', { name: /Dark/ })).toHaveClass('active')
    expect(screen.getByRole('radio', { name: /Day/ })).not.toHaveClass('active')
  })

  it('marks the active theme swatch per themeMode (day)', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'day', weekStart: 0 },
    })
    expect(screen.getByRole('radio', { name: /Day/ })).toHaveClass('active')
    expect(screen.getByRole('radio', { name: /Dark/ })).not.toHaveClass('active')
  })

  it('aria-checked mirrors themeMode on each swatch', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(screen.getByRole('radio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('radio', { name: /Day/ })).toHaveAttribute('aria-checked', 'false')
  })

  it('emits go-to-view ingest when the "Parse →" link is clicked', async () => {
    const { app } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await fireEvent.click(button(/Parse/))
    expect(app.view).toBe('ingest')
  })

  it('emits go-to-view matches when the "Week of" cross-reference is clicked', async () => {
    const { app } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await fireEvent.click(button(/Week of/))
    expect(app.view).toBe('matches')
  })

  // ── Calendar section: 7-cell first-day picker ─────────────────

  const weekCells = () => screen.getAllByTitle(/^Weeks begin on /)

  it('renders the Calendar section with seven day cells', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(screen.getByText('Calendar')).toBeInTheDocument()
    expect(screen.getByText('First Day of Week')).toBeInTheDocument()
    expect(weekCells()).toHaveLength(7)
  })

  it('marks the active weekstart cell per weekStart prop (any day 0-6)', () => {
    for (let day = 0; day <= 6; day++) {
      const { view } = renderSettings({
        props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 },
      })
      weekCells().forEach((cell, i) => {
        if (i === day) expect(cell).toHaveClass('active')
        else expect(cell).not.toHaveClass('active')
      })
      view.unmount()
    }
  })

  it('aria-checked mirrors weekStart for assistive tech', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 3 },
    })
    weekCells().forEach((cell, i) => {
      expect(cell).toHaveAttribute('aria-checked', i === 3 ? 'true' : 'false')
    })
  })

  it('emits set-week-start with the numeric day index on cell click', async () => {
    const { spies } = renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    // Friday (index 5)
    await fireEvent.click(weekCells()[5]!)
    expect(spies.setWeekStart).toHaveBeenCalledWith(5)
    // Saturday (index 6)
    await fireEvent.click(weekCells()[6]!)
    expect(spies.setWeekStart).toHaveBeenCalledWith(6)
  })

  it('shows the resolved day name in the weekstart caption', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 3 },
    })
    expect(screen.getByText(/Wednesday/)).toBeInTheDocument()
  })

  it('renders a help affordance for every setting label', () => {
    renderSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    // Screenshots Folder, Data Location, Engine, Theme, First Day of
    // Week, Profiles, Backup, Import matches, Restore, Manage ignored
    // screenshots, Re-parse All, Clear DB. The last five live inside the
    // closed <details> but are still in the DOM. Each help affordance is
    // a role="note" span.
    expect(screen.getAllByRole('note')).toHaveLength(12)
  })
})

// ── Engine section (Tesseract) ───────────────────────────────────────────


function readyTesseract(over: Partial<TesseractStatus> = {}): TesseractStatus {
  return {
    path: '/usr/local/bin/tesseract',
    found: true,
    version: '5.5.0',
    supported: true,
    error: '',
    default: '/usr/local/bin/tesseract',
    platform: 'darwin',
    ...over,
  }
}

describe('SettingsView — Engine section', () => {
  const baseEngineProps = {
    screenshotsDir: '/srv',
    parseBusy: false,
    themeMode: 'dark' as const,
    weekStart: 0 as const,
    tesseractReady: true,
    tesseractSupported: true,
    tesseractStatus: readyTesseract(),
    tesseractPickerBusy: false,
  }

  it('shows the engine-status panel as "Detected" when Tesseract is ready', () => {
    renderSettings({ props: baseEngineProps })
    const status = engineStatus()
    expect(status).toHaveClass('ok')
    expect(status).toHaveTextContent('Detected')
  })

  it('marks the row as alert + status fail when Tesseract is not ready', () => {
    renderSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false, error: 'binary not found' }),
      },
    })
    expect(engineRow()).toHaveClass('alert')
    expect(engineStatus()).toHaveClass('fail')
    expect(screen.getByText(/binary not found/)).toBeInTheDocument()
  })

  it('renders engine-unsupported warning with role="status" for non-5.x Tesseract', () => {
    renderSettings({
      props: {
        ...baseEngineProps,
        tesseractSupported: false,
        tesseractStatus: readyTesseract({ version: '4.1.1', supported: false }),
      },
    })
    expect(within(engineSection()).getByRole('status')).toBeInTheDocument()
  })

  it('emits pick-tesseract from the Change Binary button', async () => {
    const { spies } = renderSettings({ props: baseEngineProps })
    await fireEvent.click(button(/Change Binary/))
    expect(spies.pickTesseractBinary).toHaveBeenCalled()
  })

  // Detect-button gating mirrors the screenshots-dir Detect: enabled
  // + primary when no binary is configured (or the configured one
  // isn't working), disabled when the binary is healthy. After the
  // user-reported regression — "I had to pick the binary manually on
  // Windows" — Detect is the recommended action and gets the primary
  // CTA style when it'd actually do something useful.
  //
  // Lookups are scoped to the Engine section (`#sec-engine`) because
  // the screenshots-folder row ALSO renders a Detect/Reset button.

  it('renders Detect as the primary CTA when Tesseract is not ready', () => {
    renderSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false }),
      },
    })
    const btn = engineButton('Detect')!
    expect(btn).toBeDefined()
    expect(btn).toHaveClass('primary')
    expect(btn).toBeEnabled()
  })

  it('disables Detect when Tesseract is already detected', () => {
    renderSettings({
      props: baseEngineProps,
    })
    expect(engineButton('Detect')).toBeDisabled()
  })

  it('emits detect-tesseract when the Detect button is clicked while not ready', async () => {
    const { spies } = renderSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false }),
      },
    })
    await fireEvent.click(engineButton('Detect')!)
    expect(spies.detectTesseractBinary).toHaveBeenCalled()
  })

  it('emits reset-tesseract when the Reset button is clicked', async () => {
    const { spies } = renderSettings({
      props: {
        ...baseEngineProps,
        tesseractStatus: readyTesseract({
          path: '/elsewhere/tesseract',
          default: '/usr/local/bin/tesseract',
        }),
      },
    })
    await fireEvent.click(engineButton('Reset')!)
    expect(spies.resetTesseractPath).toHaveBeenCalled()
  })

  it('disables Reset when the configured path is already the platform default', () => {
    renderSettings({
      props: {
        ...baseEngineProps,
        tesseractStatus: readyTesseract({
          path: '/usr/local/bin/tesseract',
          default: '/usr/local/bin/tesseract',
        }),
      },
    })
    expect(engineButton('Reset')).toBeDisabled()
  })
})

// ── Engine description — only the host OS's install paths render ─────────

describe('SettingsView — Engine description per platform', () => {
  // User-reported confusion: the prior copy named all three install
  // locations in one sentence ("On macOS … /opt/homebrew/bin … apt
  // installs to /usr/bin … Windows installers put it in Program Files").
  // A user reading it on their own machine has no idea which path to
  // follow. The fix surfaces only the host-platform paragraph based on
  // tesseractStatus.platform (sourced from runtime.GOOS server-side).

  const baseEngineProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
    tesseractReady: true, tesseractSupported: true, tesseractPickerBusy: false,
  }

  it('shows only the macOS Homebrew paths when platform=darwin', () => {
    renderSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'darwin' }) },
    })
    const desc = engineDesc()
    expect(desc).toHaveTextContent('/opt/homebrew/bin')
    expect(desc).toHaveTextContent('/usr/local/bin')
    expect(desc).not.toHaveTextContent('Program Files')
    expect(desc).not.toHaveTextContent(/\/usr\/bin(?!\/)/)
  })

  it('shows only the Linux apt path when platform=linux', () => {
    renderSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'linux' }) },
    })
    const desc = engineDesc()
    expect(desc).toHaveTextContent('/usr/bin')
    expect(desc).not.toHaveTextContent('Program Files')
    expect(desc).not.toHaveTextContent('/opt/homebrew/bin')
  })

  it('shows only the Windows Program Files path when platform=windows', () => {
    renderSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'windows' }) },
    })
    const desc = engineDesc()
    expect(desc).toHaveTextContent('Program Files')
    expect(desc).toHaveTextContent('Tesseract-OCR')
    expect(desc).not.toHaveTextContent('/opt/homebrew/bin')
    expect(desc).not.toHaveTextContent(/\/usr\/bin/)
  })

  // Fallback: unknown platform (BSD variants, an old client running
  // against a newer server) should still see the lead sentence so the
  // panel doesn't look broken. We just won't promise specific paths.
  it('falls back to a generic sentence when platform is unknown', () => {
    renderSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'plan9' }) },
    })
    const desc = engineDesc()
    expect(desc).toHaveTextContent('Tesseract')
    expect(desc).not.toHaveTextContent('Program Files')
    expect(desc).not.toHaveTextContent('/opt/homebrew/bin')
  })
})

// ── Backup & Restore section ─────────────────────────────────────────────

describe('SettingsView — Backup & Restore', () => {
  const baseProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders Backup, Import matches, and Restore controls', () => {
    renderSettings({ props: baseProps })
    expect(button('Backup (.db)')).toBeInTheDocument()
    expect(button(/Import matches/)).toBeInTheDocument()
    expect(button(/Restore \(\.db\)/)).toBeInTheDocument()
  })

  it('emits backup when the Backup button is clicked', async () => {
    const { spies } = renderSettings({ props: baseProps })
    await fireEvent.click(button('Backup (.db)'))
    expect(spies.backup).toHaveBeenCalled()
  })

  it('emits import-matches when the Import matches button is clicked', async () => {
    const { spies } = renderSettings({ props: baseProps })
    await fireEvent.click(button(/Import matches/))
    expect(spies.importMatches).toHaveBeenCalled()
  })

  it('shows "Saving…" on the Backup button while backingUp and disables it', () => {
    renderSettings({
      props: { ...baseProps, backingUp: true },
    })
    expect(button(/Saving/)).toBeDisabled()
  })

  it('renders the success chip when status.ok is true', () => {
    renderSettings({
      props: {
        ...baseProps,
        backupStatus: { ok: true, message: 'Saved: /tmp/recall.db' },
      },
    })
    const chip = screen.getByText('Saved: /tmp/recall.db')
    expect(chip).toHaveClass('success')
  })

  it('renders the failure chip when status.ok is false', () => {
    renderSettings({
      props: {
        ...baseProps,
        backupStatus: { ok: false, message: 'Backup failed: boom' },
      },
    })
    const chip = screen.getByText('Backup failed: boom')
    expect(chip).toHaveClass('blocked')
  })

  it('shows the unarmed "Restore (.db)…" button by default', () => {
    renderSettings({ props: baseProps })
    expect(button(/Restore \(\.db\)/)).toHaveClass('danger-outline')
  })

  it('arms / confirms / cancels the Restore flow', async () => {
    const { spies, matches } = renderSettings({ props: baseProps })
    await fireEvent.click(button(/Restore \(\.db\)/))
    expect(spies.armRestore).toHaveBeenCalled()

    matches.restoreArmed = true
    matches.records = makeRecords(5, 0)
    await nextTick()
    expect(screen.getByText(/wipes 5 record/)).toBeInTheDocument()

    await fireEvent.click(button(/Choose File/))
    expect(spies.restore).toHaveBeenCalled()

    await fireEvent.click(button('Cancel'))
    expect(spies.cancelRestore).toHaveBeenCalled()
  })

  it('disables Restore + Import while a backup is in flight', () => {
    renderSettings({
      props: { ...baseProps, backingUp: true },
    })
    expect(button(/Restore \(\.db\)/)).toBeDisabled()
    expect(button(/Import matches/)).toBeDisabled()
  })
})

// ── Advanced collapsible (Clear DB) ──────────────────────────────────────

describe('SettingsView — Advanced section', () => {
  const baseProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the Advanced <details> closed by default', () => {
    renderSettings({ props: baseProps })
    // The native <details> disclosure state only reads through its
    // `open` property.
    // eslint-disable-next-line testing-library/no-node-access -- native details open-state has no accessible-query equivalent in happy-dom
    const det = document.querySelector('details.advanced-section') as HTMLDetailsElement
    expect(det).not.toBeNull()
    expect(det.open).toBe(false)
  })

  it('arms Clear Database, confirms delete, then cancels', async () => {
    const { spies, matches } = renderSettings({
      props: { ...baseProps, matchedCount: 4, unknownCount: 0 },
    })
    await fireEvent.click(button(/Clear Database/))
    expect(spies.armClear).toHaveBeenCalled()

    matches.clearConfirm = true
    matches.records = makeRecords(4, 0)
    await nextTick()
    await fireEvent.click(button(/Delete 4 Records/))
    expect(spies.onClearDatabase).toHaveBeenCalled()

    await fireEvent.click(button('Cancel'))
    expect(spies.cancelClear).toHaveBeenCalled()
  })

  it('disables Clear Database when no records exist', () => {
    renderSettings({
      props: { ...baseProps, matchedCount: 0, unknownCount: 0 },
    })
    expect(button(/Clear Database/)).toBeDisabled()
  })
})

// ── Data Location row (Directories section) ──────────────────────────────

describe('SettingsView — Data Location row', () => {
  const baseProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }
  const sampleLoc = {
    base_dir: '/data',
    settings_path: '/data/settings.json',
    database_path: '/data/db/recall.db',
    screenshots_dir: '/srv',
  }

  it('renders both paths when dataLocation is populated', () => {
    renderSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const grid = dataLocGrid()
    expect(grid).toHaveTextContent('/data/db/recall.db')
    expect(grid).toHaveTextContent('/data/settings.json')
  })

  it('hides the path grid when dataLocation is null but still shows the label', () => {
    renderSettings({
      props: { ...baseProps, dataLocation: null },
    })
    expect(screen.getByText('Data Location')).toBeInTheDocument()
    expect(dataLocGrid()).toBeNull()
  })

  it('renders a Copy button per path row', () => {
    renderSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    // Two action clusters — one per path — each with a Copy.
    const clusters = dataLocActions()
    expect(clusters).toHaveLength(2)
    clusters.forEach(c => {
      expect(within(c).getByRole('button', { name: 'Copy' })).toBeInTheDocument()
    })
  })

  it('writes the database path to the clipboard when its Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    await fireEvent.click(within(dataLocActions()[0]!).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('/data/db/recall.db')
  })

  it('writes the settings path to the clipboard when its Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    renderSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    await fireEvent.click(within(dataLocActions()[1]!).getByRole('button', { name: 'Copy' }))
    expect(writeText).toHaveBeenCalledWith('/data/settings.json')
  })

  it('flashes Copied ✓ on the right button after a successful copy', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })
      renderSettings({
        props: { ...baseProps, dataLocation: sampleLoc },
      })
      await fireEvent.click(within(dataLocActions()[0]!).getByRole('button', { name: 'Copy' }))
      await Promise.resolve()
      await nextTick()
      expect(screen.getByText(/Copied ✓/)).toBeInTheDocument()

      // The label clears 1.4 s later.
      vi.advanceTimersByTime(1500)
      await nextTick()
      expect(screen.queryByText(/Copied ✓/)).not.toBeInTheDocument()
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to a prompt() when the Clipboard API rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    const promptSpy = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', promptSpy)

    renderSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    await fireEvent.click(within(dataLocActions()[0]!).getByRole('button', { name: 'Copy' }))
    await Promise.resolve()
    await Promise.resolve()
    expect(promptSpy).toHaveBeenCalledWith('Copy this path:', '/data/db/recall.db')
    vi.unstubAllGlobals()
  })
})

// ── First-run picker (empty-state hero) — the four-source grid +
//    custom-pick tile replaced the old Auto-Detect / Choose Manually
//    button pair. See ScreenshotSourcePicker.test.ts for picker-level
//    coverage; here we only verify the wiring.

describe('SettingsView — First-run picker (empty state hero)', () => {
  const emptyProps = {
    screenshotsDir: '', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  const sourceGrid = () => screen.queryByLabelText('Auto-detected screenshot sources')

  it('mounts the ScreenshotSourcePicker inside the empty-hero', () => {
    renderSettings({ props: emptyProps })
    expect(screen.getByRole('button', { name: /Pick a different folder/ })).toBeInTheDocument()
  })

  it('renders the picker grid when platform=windows and candidates supplied', () => {
    renderSettings({
      props: {
        ...emptyProps,
        platform: 'windows',
        tesseractStatus: defaultTess({ platform: 'windows' }),
        screenshotCandidates: [
          { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\v\\OW', exists: true  },
          { name: 'prntscn', label: 'OW default',     path: 'C:\\d\\OW', exists: false },
          { name: 'snip',    label: 'Snip tool',      path: 'C:\\p\\SS', exists: true  },
          { name: 'steam',   label: 'Steam install',  path: '',           exists: false },
        ] as const,
      },
    })
    const grid = sourceGrid()
    expect(grid).toBeInTheDocument()
    expect(within(grid!).getAllByRole('button')).toHaveLength(4)
  })

  it('emits pick-detected-source with the path when a found card is clicked', async () => {
    const { spies } = renderSettings({
      props: {
        ...emptyProps,
        platform: 'windows',
        tesseractStatus: defaultTess({ platform: 'windows' }),
        screenshotCandidates: [
          { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\v\\OW', exists: true  },
          { name: 'prntscn', label: 'OW default',     path: '',           exists: false },
          { name: 'snip',    label: 'Snip tool',      path: '',           exists: false },
          { name: 'steam',   label: 'Steam install',  path: '',           exists: false },
        ] as const,
      },
    })
    await fireEvent.click(screen.getByRole('button', { name: /Nvidia Overlay/ }))
    expect(spies.pickDetectedSource).toHaveBeenCalledWith('C:\\v\\OW')
  })

  it('emits pick-screenshots-dir when the custom-pick tile is clicked', async () => {
    const { spies } = renderSettings({
      props: { ...emptyProps, platform: 'darwin', screenshotCandidates: [] },
    })
    await fireEvent.click(screen.getByRole('button', { name: /Pick a different folder/ }))
    expect(spies.pickDir).toHaveBeenCalled()
  })

  it('hides the grid on macOS', () => {
    renderSettings({
      props: { ...emptyProps, platform: 'darwin', screenshotCandidates: [] },
    })
    expect(sourceGrid()).not.toBeInTheDocument()
    expect(screen.getByText(/WINDOWS ONLY/)).toBeInTheDocument()
  })
})

describe('SettingsView — steady-state row affordances', () => {
  const setProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  // The folders row's Detect (the Engine row has its own — scope by
  // taking the FIRST match in DOM order, which is the folders row).
  const foldersDetect = () => screen.getAllByRole('button', { name: 'Detect' })[0]!

  it('renders a Detect button alongside Change… in the steady-state row', () => {
    renderSettings({ props: setProps })
    expect(foldersDetect()).toBeInTheDocument()
  })

  // Detect renders but stays disabled when a folder is set — the
  // user must Reset first to re-enable auto-detection. Confirmed
  // emit-side: a click on a disabled button produces no event.
  it('keeps the steady-state Detect button disabled', () => {
    renderSettings({ props: setProps })
    expect(foldersDetect()).toBeDisabled()
  })

  it('emits reveal-screenshots-dir when Reveal is clicked', async () => {
    const { spies } = renderSettings({ props: setProps })
    await fireEvent.click(button('Reveal'))
    expect(spies.revealDir).toHaveBeenCalled()
  })

  it('emits reset-screenshots-dir when Reset is clicked', async () => {
    const { spies } = renderSettings({ props: setProps })
    await fireEvent.click(screen.getAllByRole('button', { name: 'Reset' })[0]!)
    expect(spies.resetDir).toHaveBeenCalled()
  })
})

describe('SettingsView — Probe chip', () => {
  const emptyProps = {
    screenshotsDir: '', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the success chip when probeStatus=success', () => {
    renderSettings({
      props: {
        ...emptyProps,
        probeStatus: 'success',
        probeMessage: 'Detected · /home/u/Documents/Overwatch/ScreenShots/Overwatch',
      },
    })
    const chip = probeChip()
    expect(chip).toHaveClass('success')
    expect(chip).toHaveTextContent('Detected')
  })

  it('renders the blocked chip + Looked-in disclosure when probeStatus=blocked', () => {
    renderSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: ['/a/path', '/b/path'],
      },
    })
    expect(probeChip()).toHaveClass('blocked')
    expect(screen.getByText('/a/path')).toBeInTheDocument()
    expect(screen.getByText('/b/path')).toBeInTheDocument()
  })

  it('hides the Looked-in disclosure when probeTried is empty on the blocked path', () => {
    renderSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: [],
      },
    })
    expect(screen.queryByText(/Looked in/)).not.toBeInTheDocument()
  })

  it('renders no chip at all when probeMessage is empty', () => {
    renderSettings({ props: emptyProps })
    expect(probeChip()).toBeNull()
  })

  it('dismisses the chip when the close × is clicked', async () => {
    renderSettings({
      props: {
        ...emptyProps,
        probeStatus: 'success',
        probeMessage: 'Detected · /path',
      },
    })
    expect(probeChip()).not.toBeNull()
    // eslint-disable-next-line testing-library/no-node-access -- the chip close glyph carries no accessible name; scoped by the chip class the e2e shares
    await fireEvent.click(document.querySelector('.probe-chip-close')!)
    expect(probeChip()).toBeNull()
  })

  it('re-opens the chip when a new probeMessage lands after dismissal', async () => {
    const { settings } = renderSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default on this machine.',
      },
    })
    // eslint-disable-next-line testing-library/no-node-access -- the chip close glyph carries no accessible name; scoped by the chip class the e2e shares
    await fireEvent.click(document.querySelector('.probe-chip-close')!)
    expect(probeChip()).toBeNull()

    settings.probeStatus = 'success'
    settings.probeMessage = 'Detected · /path'
    await nextTick()
    expect(probeChip()).not.toBeNull()
  })
})

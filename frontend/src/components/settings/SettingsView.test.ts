import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'

import SettingsView from '@/components/settings/SettingsView.vue'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useSettingsStore } from '@/stores/settings'
import type { ThemeMode } from '@/composables/settings/useTheme'
import type { WeekStart } from '@/composables/shared/useWeekStart'
import type { MatchRecord, TesseractStatus, DataLocation, NamedCandidate } from '@/api'

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

// Seeds the three stores from the old prop shape (theme/week-start are seeded
// via the real setters BEFORE the spies are installed so the seed isn't counted
// as a click), then spies on every action a sub-section button drives.
function mountSettings(opts: { props?: SettingsOver } = {}) {
  const over = opts.props ?? {}
  setActivePinia(createPinia())
  const app = useAppStore()
  const matches = useMatchesStore()
  const settings = useSettingsStore()

  settings.setTesseractStatus(over.tesseractStatus ?? defaultTess({
    found:     over.tesseractReady ?? true,
    supported: over.tesseractSupported ?? true,
    platform:  over.platform ?? 'darwin',
  }))
  settings.setScreenshotsDir(over.screenshotsDir ?? '/srv/recall')
  settings.setTheme(over.themeMode ?? 'dark')
  settings.setWeekStart(over.weekStart ?? 0)
  settings.screenshotCandidates = over.screenshotCandidates ?? []
  settings.probing = over.probing ?? false
  settings.probeMessage = over.probeMessage ?? ''
  settings.probeStatus = over.probeStatus ?? ''
  settings.probeTried = over.probeTried ?? []
  settings.tesseractPickerBusy = over.tesseractPickerBusy ?? false

  matches.parseBusy = over.parseBusy ?? false
  matches.backingUp = over.backingUp ?? false
  matches.restoring = over.restoring ?? false
  matches.restoreArmed = over.restoreArmed ?? false
  matches.importingMatches = over.importingMatches ?? false
  matches.backupStatus = over.backupStatus ?? null
  matches.clearConfirm = over.clearConfirm ?? false
  matches.clearingDB = over.clearingDB ?? false
  matches.records = makeRecords(over.matchedCount ?? 0, over.unknownCount ?? 0)
  if (over.ignoredCount != null) {
    matches.ignoredScreenshots = Array.from({ length: over.ignoredCount }, (_, i) => ({ filename: `ig-${i}.png`, ignored_at: '2026-05-10T00:00:00Z' }))
  }

  app.dataLocation = over.dataLocation ?? null

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

  const wrapper = mount(SettingsView)
  return { wrapper, app, matches, settings, spies }
}

describe('SettingsView', () => {
  it('shows the empty-state hero when no folder is selected', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Choose a')
    expect(wrapper.text()).toContain('screenshots folder')
    // The empty-state hero card is the primary affordance.
    expect(wrapper.find('.empty-hero').exists()).toBe(true)
    // No setting-value chip should render — the row is hidden in the
    // empty state because the hero owns the CTA.
    expect(wrapper.find('.setting-value').exists()).toBe(false)
  })

  it('shows the "where Recall reads from" heading once a folder is configured', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv/recall', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Where Recall reads from')
    expect(wrapper.find('.setting-value').text()).toBe('/srv/recall')
    expect(wrapper.find('.empty-hero').exists()).toBe(false)
  })

  it('emits pick-screenshots-dir when the Change… button is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(spies.pickDir).toHaveBeenCalled()
  })

  it('disables the Change… button while parseBusy=true', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: true, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits set-theme with the picked mode when a swatch is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await wrapper.find('.day-swatch').trigger('click')
    expect(spies.setTheme).toHaveBeenCalled()
    expect(spies.setTheme).toHaveBeenCalledWith('day')
  })

  it('emits set-theme with "high-contrast" when the Contrast swatch is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    await wrapper.find('.contrast-swatch').trigger('click')
    expect(spies.setTheme).toHaveBeenCalledWith('high-contrast')
  })

  it('marks the active theme swatch per themeMode prop', () => {
    const { wrapper: dark } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(dark.find('.dark-swatch').classes()).toContain('active')
    expect(dark.find('.day-swatch').classes()).not.toContain('active')

    const { wrapper: light } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'day', weekStart: 0 },
    })
    expect(light.find('.day-swatch').classes()).toContain('active')
    expect(light.find('.dark-swatch').classes()).not.toContain('active')
  })

  it('aria-checked mirrors themeMode on each swatch', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.find('.dark-swatch').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('.day-swatch').attributes('aria-checked')).toBe('false')
  })

  it('emits go-to-view ingest when the "Parse →" link is clicked', async () => {
    const { wrapper, app } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Parse'))!
    await link.trigger('click')
    expect(app.view).toBe('ingest')
  })

  it('emits go-to-view matches when the "Week of" cross-reference is clicked', async () => {
    const { wrapper, app } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Week of'))!
    await link.trigger('click')
    expect(app.view).toBe('matches')
  })

  // ── Calendar section: 7-cell first-day picker ─────────────────

  it('renders the Calendar section with seven day cells', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Calendar')
    expect(wrapper.text()).toContain('First Day of Week')
    const cells = wrapper.findAll('.weekstart-cell')
    expect(cells).toHaveLength(7)
  })

  it('marks the active weekstart cell per weekStart prop (any day 0-6)', () => {
    for (let day = 0; day <= 6; day++) {
      const { wrapper } = mountSettings({
        props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 },
      })
      const cells = wrapper.findAll('.weekstart-cell')
      cells.forEach((cell, i) => {
        if (i === day) expect(cell.classes()).toContain('active')
        else expect(cell.classes()).not.toContain('active')
      })
    }
  })

  it('aria-checked mirrors weekStart for assistive tech', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 3 },
    })
    const cells = wrapper.findAll('.weekstart-cell')
    cells.forEach((cell, i) => {
      expect(cell.attributes('aria-checked')).toBe(i === 3 ? 'true' : 'false')
    })
  })

  it('emits set-week-start with the numeric day index on cell click', async () => {
    const { wrapper, spies } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    const cells = wrapper.findAll('.weekstart-cell')
    // Friday (index 5)
    await cells[5]!.trigger('click')
    expect(spies.setWeekStart).toHaveBeenCalledWith(5)
    // Saturday (index 6)
    await cells[6]!.trigger('click')
    expect(spies.setWeekStart).toHaveBeenCalledWith(6)
  })

  it('shows the resolved day name in the weekstart caption', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 3 },
    })
    const cap = wrapper.find('.weekstart-caption')
    expect(cap.text()).toContain('Wednesday')
  })

  it('renders a help affordance for every setting label', () => {
    const { wrapper } = mountSettings({
      props: { screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark', weekStart: 0 },
    })
    // Screenshots Folder, Data Location, Engine, Theme, First Day of
    // Week, Profiles, Backup, Import matches, Restore, Manage ignored
    // screenshots, Re-parse All, Clear DB. The last five live inside the
    // closed <details> but are still in the DOM.
    expect(wrapper.findAll('.setting-help')).toHaveLength(12)
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
    const { wrapper } = mountSettings({ props: baseEngineProps })
    const status = wrapper.find('.engine-status')
    expect(status.exists()).toBe(true)
    expect(status.classes()).toContain('ok')
    expect(status.text()).toContain('Detected')
  })

  it('marks the row as alert + status fail when Tesseract is not ready', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false, error: 'binary not found' }),
      },
    })
    expect(wrapper.find('.engine-row').classes()).toContain('alert')
    expect(wrapper.find('.engine-status').classes()).toContain('fail')
    expect(wrapper.text()).toContain('binary not found')
  })

  it('renders engine-unsupported warning with role="status" for non-5.x Tesseract', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractSupported: false,
        tesseractStatus: readyTesseract({ version: '4.1.1', supported: false }),
      },
    })
    const warn = wrapper.find('.engine-unsupported-warn')
    expect(warn.exists()).toBe(true)
    expect(warn.attributes('role')).toBe('status')
  })

  it('emits pick-tesseract from the Change Binary button', async () => {
    const { wrapper, spies } = mountSettings({ props: baseEngineProps })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Binary'))!
    await btn.trigger('click')
    expect(spies.pickTesseractBinary).toHaveBeenCalled()
  })

  // Detect-button gating mirrors the screenshots-dir Detect: enabled
  // + primary when no binary is configured (or the configured one
  // isn't working), disabled when the binary is healthy. After the
  // user-reported regression — "I had to pick the binary manually on
  // Windows" — Detect is the recommended action and gets the primary
  // CTA style when it'd actually do something useful.
  //
  // Helper: scope button lookups to the Engine row (`#sec-engine`)
  // because the screenshots-folder row ALSO renders a Detect/Reset
  // button and `.find()` would return that one first otherwise.
  function findEngineBtn(wrapper: ReturnType<typeof mount>, text: string) {
    return wrapper.find('#sec-engine')
      .findAll('button')
      .find(b => b.text().trim() === text)
  }

  it('renders Detect as the primary CTA when Tesseract is not ready', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false }),
      },
    })
    const btn = findEngineBtn(wrapper, 'Detect')!
    expect(btn).toBeDefined()
    expect(btn.classes()).toContain('primary')
    expect(btn.attributes('disabled')).toBeUndefined()
  })

  it('disables Detect when Tesseract is already detected', () => {
    const { wrapper } = mountSettings({
      props: baseEngineProps,
    })
    const btn = findEngineBtn(wrapper, 'Detect')!
    expect(btn).toBeDefined()
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits detect-tesseract when the Detect button is clicked while not ready', async () => {
    const { wrapper, spies } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false }),
      },
    })
    const btn = findEngineBtn(wrapper, 'Detect')!
    await btn.trigger('click')
    expect(spies.detectTesseractBinary).toHaveBeenCalled()
  })

  it('emits reset-tesseract when the Reset button is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractStatus: readyTesseract({
          path: '/elsewhere/tesseract',
          default: '/usr/local/bin/tesseract',
        }),
      },
    })
    const btn = findEngineBtn(wrapper, 'Reset')!
    await btn.trigger('click')
    expect(spies.resetTesseractPath).toHaveBeenCalled()
  })

  it('disables Reset when the configured path is already the platform default', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseEngineProps,
        tesseractStatus: readyTesseract({
          path: '/usr/local/bin/tesseract',
          default: '/usr/local/bin/tesseract',
        }),
      },
    })
    const btn = findEngineBtn(wrapper, 'Reset')!
    expect(btn.attributes('disabled')).toBeDefined()
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
    const { wrapper } = mountSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'darwin' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('/opt/homebrew/bin')
    expect(desc.text()).toContain('/usr/local/bin')
    expect(desc.text()).not.toContain('Program Files')
    expect(desc.text()).not.toContain('/usr/bin')
  })

  it('shows only the Linux apt path when platform=linux', () => {
    const { wrapper } = mountSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'linux' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('/usr/bin')
    expect(desc.text()).not.toContain('Program Files')
    expect(desc.text()).not.toContain('/opt/homebrew/bin')
  })

  it('shows only the Windows Program Files path when platform=windows', () => {
    const { wrapper } = mountSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'windows' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('Program Files')
    expect(desc.text()).toContain('Tesseract-OCR')
    expect(desc.text()).not.toContain('/opt/homebrew/bin')
    expect(desc.text()).not.toContain('/usr/bin')
  })

  // Fallback: unknown platform (BSD variants, an old client running
  // against a newer server) should still see the lead sentence so the
  // panel doesn't look broken. We just won't promise specific paths.
  it('falls back to a generic sentence when platform is unknown', () => {
    const { wrapper } = mountSettings({
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'plan9' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('Tesseract')
    expect(desc.text()).not.toContain('Program Files')
    expect(desc.text()).not.toContain('/opt/homebrew/bin')
  })
})

// ── Backup & Restore section ─────────────────────────────────────────────

describe('SettingsView — Backup & Restore', () => {
  const baseProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders Backup, Import matches, and Restore controls', () => {
    const { wrapper } = mountSettings({ props: baseProps })
    const backup = wrapper.findAll('button').find(b => b.text().trim() === 'Backup (.db)')
    const importMatches = wrapper.findAll('button').find(b => b.text().includes('Import matches'))
    const restore = wrapper.findAll('button').find(b => b.text().includes('Restore (.db)'))
    expect(backup).toBeDefined()
    expect(importMatches).toBeDefined()
    expect(restore).toBeDefined()
  })

  it('emits backup when the Backup button is clicked', async () => {
    const { wrapper, spies } = mountSettings({ props: baseProps })
    const backup = wrapper.findAll('button').find(b => b.text().trim() === 'Backup (.db)')!
    await backup.trigger('click')
    expect(spies.backup).toHaveBeenCalled()
  })

  it('emits import-matches when the Import matches button is clicked', async () => {
    const { wrapper, spies } = mountSettings({ props: baseProps })
    const importBtn = wrapper.findAll('button').find(b => b.text().includes('Import matches'))!
    await importBtn.trigger('click')
    expect(spies.importMatches).toHaveBeenCalled()
  })

  it('shows "Saving…" on the Backup button while backingUp and disables it', () => {
    const { wrapper } = mountSettings({
      props: { ...baseProps, backingUp: true },
    })
    const saving = wrapper.findAll('button').find(b => b.text().includes('Saving'))!
    expect(saving.attributes('disabled')).toBeDefined()
  })

  it('renders the success chip when status.ok is true', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseProps,
        backupStatus: { ok: true, message: 'Saved: /tmp/recall.db' },
      },
    })
    expect(wrapper.text()).toContain('Saved: /tmp/recall.db')
    expect(wrapper.find('.setting-meta.success').exists()).toBe(true)
  })

  it('renders the failure chip when status.ok is false', () => {
    const { wrapper } = mountSettings({
      props: {
        ...baseProps,
        backupStatus: { ok: false, message: 'Backup failed: boom' },
      },
    })
    expect(wrapper.text()).toContain('Backup failed: boom')
    expect(wrapper.find('.setting-meta.blocked').exists()).toBe(true)
  })

  it('shows the unarmed "Restore (.db)…" button by default', () => {
    const { wrapper } = mountSettings({ props: baseProps })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Restore (.db)'))!
    expect(btn).toBeDefined()
    expect(btn.classes()).toContain('danger-outline')
  })

  it('arms / confirms / cancels the Restore flow', async () => {
    const { wrapper, spies, matches } = mountSettings({ props: baseProps })
    const arm = wrapper.findAll('button').find(b => b.text().includes('Restore (.db)'))!
    await arm.trigger('click')
    expect(spies.armRestore).toHaveBeenCalled()

    matches.restoreArmed = true
    matches.records = makeRecords(5, 0)
    await nextTick()
    const choose = wrapper.findAll('button').find(b => b.text().includes('Choose File'))!
    expect(choose).toBeDefined()
    expect(wrapper.text()).toMatch(/wipes 5 record/)

    await choose.trigger('click')
    expect(spies.restore).toHaveBeenCalled()

    const cancel = wrapper.findAll('button').find(b => b.text().trim() === 'Cancel')!
    await cancel.trigger('click')
    expect(spies.cancelRestore).toHaveBeenCalled()
  })

  it('disables Restore + Import while a backup is in flight', () => {
    const { wrapper } = mountSettings({
      props: { ...baseProps, backingUp: true },
    })
    const restoreBtn = wrapper.findAll('button').find(b => b.text().includes('Restore (.db)'))!
    expect(restoreBtn.attributes('disabled')).toBeDefined()
    const importBtn = wrapper.findAll('button').find(b => b.text().includes('Import matches'))!
    expect(importBtn.attributes('disabled')).toBeDefined()
  })
})

// ── Advanced collapsible (Clear DB) ──────────────────────────────────────

describe('SettingsView — Advanced section', () => {
  const baseProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the Advanced <details> closed by default', () => {
    const { wrapper } = mountSettings({ props: baseProps })
    const det = wrapper.find('details.advanced-section')
    expect(det.exists()).toBe(true)
    expect((det.element as HTMLDetailsElement).open).toBe(false)
  })

  it('arms Clear Database, confirms delete, then cancels', async () => {
    const { wrapper, spies, matches } = mountSettings({
      props: { ...baseProps, matchedCount: 4, unknownCount: 0 },
    })
    const arm = wrapper.findAll('button').find(b => b.text().includes('Clear Database'))!
    await arm.trigger('click')
    expect(spies.armClear).toHaveBeenCalled()

    matches.clearConfirm = true
    matches.records = makeRecords(4, 0)
    await nextTick()
    const del = wrapper.findAll('button').find(b => b.text().includes('Delete 4 Records'))!
    expect(del).toBeDefined()
    await del.trigger('click')
    expect(spies.onClearDatabase).toHaveBeenCalled()

    const cancel = wrapper.findAll('button').find(b => b.text().trim() === 'Cancel')!
    await cancel.trigger('click')
    expect(spies.cancelClear).toHaveBeenCalled()
  })

  it('disables Clear Database when no records exist', () => {
    const { wrapper } = mountSettings({
      props: { ...baseProps, matchedCount: 0, unknownCount: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Clear Database'))!
    expect(btn.attributes('disabled')).toBeDefined()
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
    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const grid = wrapper.find('.data-loc-grid')
    expect(grid.exists()).toBe(true)
    expect(grid.text()).toContain('/data/db/recall.db')
    expect(grid.text()).toContain('/data/settings.json')
  })

  it('hides the path grid when dataLocation is null but still shows the label', () => {
    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: null },
    })
    expect(wrapper.text()).toContain('Data Location')
    expect(wrapper.find('.data-loc-grid').exists()).toBe(false)
  })

  it('renders a Copy button per path row', () => {
    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    // Two .data-loc-actions clusters — one per path — each with a Copy.
    const clusters = wrapper.findAll('.data-loc-actions')
    expect(clusters).toHaveLength(2)
    clusters.forEach(c => {
      const copy = c.findAll('button').find(b => b.text().trim() === 'Copy')
      expect(copy).toBeDefined()
    })
  })

  it('writes the database path to the clipboard when its Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const clusters = wrapper.findAll('.data-loc-actions')
    const dbCopy = clusters[0]!.findAll('button').find(b => b.text().trim() === 'Copy')!
    await dbCopy.trigger('click')
    expect(writeText).toHaveBeenCalledWith('/data/db/recall.db')
  })

  it('writes the settings path to the clipboard when its Copy is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const clusters = wrapper.findAll('.data-loc-actions')
    const settingsCopy = clusters[1]!.findAll('button').find(b => b.text().trim() === 'Copy')!
    await settingsCopy.trigger('click')
    expect(writeText).toHaveBeenCalledWith('/data/settings.json')
  })

  it('flashes Copied ✓ on the right button after a successful copy', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })
      const { wrapper } = mountSettings({
        props: { ...baseProps, dataLocation: sampleLoc },
      })
      const dbCopy = wrapper.findAll('.data-loc-actions')[0]!
        .findAll('button').find(b => b.text().trim() === 'Copy')!
      await dbCopy.trigger('click')
      await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Copied ✓')

      // The label clears 1.4 s later.
      vi.advanceTimersByTime(1500)
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).not.toContain('Copied ✓')
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

    const { wrapper } = mountSettings({
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const dbCopy = wrapper.findAll('.data-loc-actions')[0]!
      .findAll('button').find(b => b.text().trim() === 'Copy')!
    await dbCopy.trigger('click')
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

  it('mounts the ScreenshotSourcePicker inside the empty-hero', () => {
    const { wrapper } = mountSettings({ props: emptyProps })
    expect(wrapper.find('.empty-hero').exists()).toBe(true)
    expect(wrapper.find('.src-picker').exists()).toBe(true)
  })

  it('renders the picker grid when platform=windows and candidates supplied', () => {
    const { wrapper } = mountSettings({
      props: {
        ...emptyProps,
        platform: 'windows',
        screenshotCandidates: [
          { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\v\\OW', exists: true  },
          { name: 'prntscn', label: 'OW default',     path: 'C:\\d\\OW', exists: false },
          { name: 'snip',    label: 'Snip tool',      path: 'C:\\p\\SS', exists: true  },
          { name: 'steam',   label: 'Steam install',  path: '',           exists: false },
        ] as const,
      },
    })
    expect(wrapper.find('[data-src-grid]').exists()).toBe(true)
    expect(wrapper.findAll('.src-card')).toHaveLength(4)
  })

  it('emits pick-detected-source with the path when a found card is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: {
        ...emptyProps,
        platform: 'windows',
        screenshotCandidates: [
          { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\v\\OW', exists: true  },
          { name: 'prntscn', label: 'OW default',     path: '',           exists: false },
          { name: 'snip',    label: 'Snip tool',      path: '',           exists: false },
          { name: 'steam',   label: 'Steam install',  path: '',           exists: false },
        ] as const,
      },
    })
    await wrapper.find('[data-src-name="nvidia"]').trigger('click')
    expect(spies.pickDetectedSource).toHaveBeenCalledWith('C:\\v\\OW')
  })

  it('emits pick-screenshots-dir when the custom-pick tile is clicked', async () => {
    const { wrapper, spies } = mountSettings({
      props: { ...emptyProps, platform: 'darwin', screenshotCandidates: [] },
    })
    await wrapper.find('[data-src-pick-custom]').trigger('click')
    expect(spies.pickDir).toHaveBeenCalled()
  })

  it('hides the grid on macOS', () => {
    const { wrapper } = mountSettings({
      props: { ...emptyProps, platform: 'darwin', screenshotCandidates: [] },
    })
    expect(wrapper.find('[data-src-grid]').exists()).toBe(false)
    expect(wrapper.find('[data-src-platform-note]').exists()).toBe(true)
  })
})

describe('SettingsView — steady-state row affordances', () => {
  const setProps = {
    screenshotsDir: '/srv', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders a Detect button alongside Change… in the steady-state row', () => {
    const { wrapper } = mountSettings({ props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')
    expect(detect).toBeDefined()
  })

  // Detect renders but stays disabled when a folder is set — the
  // user must Reset first to re-enable auto-detection. Confirmed
  // emit-side: a click on a disabled button produces no event.
  it('keeps the steady-state Detect button disabled', () => {
    const { wrapper } = mountSettings({ props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')!
    expect(detect.attributes('disabled')).toBeDefined()
  })

  it('emits reveal-screenshots-dir when Reveal is clicked', async () => {
    const { wrapper, spies } = mountSettings({ props: setProps })
    const reveal = wrapper.findAll('button').find(b => b.text().trim() === 'Reveal')!
    await reveal.trigger('click')
    expect(spies.revealDir).toHaveBeenCalled()
  })

  it('emits reset-screenshots-dir when Reset is clicked', async () => {
    const { wrapper, spies } = mountSettings({ props: setProps })
    const reset = wrapper.findAll('button').find(b => b.text().trim() === 'Reset')!
    await reset.trigger('click')
    expect(spies.resetDir).toHaveBeenCalled()
  })
})

describe('SettingsView — Probe chip', () => {
  const emptyProps = {
    screenshotsDir: '', parseBusy: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the success chip when probeStatus=success', () => {
    const { wrapper } = mountSettings({
      props: {
        ...emptyProps,
        probeStatus: 'success',
        probeMessage: 'Detected · /home/u/Documents/Overwatch/ScreenShots/Overwatch',
      },
    })
    const chip = wrapper.find('.probe-chip')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('success')
    expect(chip.text()).toContain('Detected')
    expect(chip.find('.probe-chip-bar').exists()).toBe(true)
  })

  it('renders the blocked chip + Looked-in disclosure when probeStatus=blocked', () => {
    const { wrapper } = mountSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: ['/a/path', '/b/path'],
      },
    })
    const chip = wrapper.find('.probe-chip')
    expect(chip.classes()).toContain('blocked')

    const details = wrapper.find('.probe-tried')
    expect(details.exists()).toBe(true)
    const items = wrapper.findAll('.probe-tried-list li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toBe('/a/path')
    expect(items[1]!.text()).toBe('/b/path')
  })

  it('hides the Looked-in disclosure when probeTried is empty on the blocked path', () => {
    const { wrapper } = mountSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: [],
      },
    })
    expect(wrapper.find('.probe-tried').exists()).toBe(false)
  })

  it('renders no chip at all when probeMessage is empty', () => {
    const { wrapper } = mountSettings({ props: emptyProps })
    expect(wrapper.find('.probe-chip').exists()).toBe(false)
  })

  it('dismisses the chip when the close × is clicked', async () => {
    const { wrapper } = mountSettings({
      props: {
        ...emptyProps,
        probeStatus: 'success',
        probeMessage: 'Detected · /path',
      },
    })
    expect(wrapper.find('.probe-chip').exists()).toBe(true)
    await wrapper.find('.probe-chip-close').trigger('click')
    expect(wrapper.find('.probe-chip').exists()).toBe(false)
  })

  it('re-opens the chip when a new probeMessage lands after dismissal', async () => {
    const { wrapper, settings } = mountSettings({
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default on this machine.',
      },
    })
    await wrapper.find('.probe-chip-close').trigger('click')
    expect(wrapper.find('.probe-chip').exists()).toBe(false)

    settings.probeStatus = 'success'
    settings.probeMessage = 'Detected · /path'
    await nextTick()
    expect(wrapper.find('.probe-chip').exists()).toBe(true)
  })
})

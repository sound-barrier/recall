import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsView from './SettingsView.vue'

// Common probs the test suite reuses. Tests run under happy-dom which
// has no Wails runtime, so IS_WAILS is false and the Open buttons
// never render — that's the contract; an Open-button test would have
// to stub window.go.app.App first.

describe('SettingsView', () => {
  it('shows the empty-state hero when no folder is selected', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '', loading: false, themeMode: 'dark', weekStart: 0 },
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
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv/owmetrics', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Where Recall reads from')
    expect(wrapper.find('.setting-value').text()).toBe('/srv/owmetrics')
    expect(wrapper.find('.empty-hero').exists()).toBe(false)
  })

  it('emits pick-screenshots-dir when the Change… button is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('pick-screenshots-dir')).toBeTruthy()
  })

  it('disables the Change… button while loading=true', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: true, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits set-theme with the picked mode when a swatch is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    await wrapper.find('.day-swatch').trigger('click')
    expect(wrapper.emitted('set-theme')).toBeTruthy()
    expect(wrapper.emitted('set-theme')![0]).toEqual(['day'])
  })

  it('emits set-theme with "high-contrast" when the Contrast swatch is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    await wrapper.find('.contrast-swatch').trigger('click')
    expect(wrapper.emitted('set-theme')![0]).toEqual(['high-contrast'])
  })

  it('marks the active theme swatch per themeMode prop', () => {
    const dark = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(dark.find('.dark-swatch').classes()).toContain('active')
    expect(dark.find('.day-swatch').classes()).not.toContain('active')

    const light = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'day', weekStart: 0 },
    })
    expect(light.find('.day-swatch').classes()).toContain('active')
    expect(light.find('.dark-swatch').classes()).not.toContain('active')
  })

  it('aria-checked mirrors themeMode on each swatch', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.find('.dark-swatch').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('.day-swatch').attributes('aria-checked')).toBe('false')
  })

  it('emits go-to-view ingest when the "Parse →" link is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Parse'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['ingest'])
  })

  it('emits go-to-view matches when the "Week of" cross-reference is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Week of'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['matches'])
  })

  // ── Calendar section: 7-cell first-day picker ─────────────────

  it('renders the Calendar section with seven day cells', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Calendar')
    expect(wrapper.text()).toContain('First Day of Week')
    const cells = wrapper.findAll('.weekstart-cell')
    expect(cells).toHaveLength(7)
  })

  it('marks the active weekstart cell per weekStart prop (any day 0-6)', () => {
    for (let day = 0; day <= 6; day++) {
      const wrapper = mount(SettingsView, {
        props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 },
      })
      const cells = wrapper.findAll('.weekstart-cell')
      cells.forEach((cell, i) => {
        if (i === day) expect(cell.classes()).toContain('active')
        else expect(cell.classes()).not.toContain('active')
      })
    }
  })

  it('aria-checked mirrors weekStart for assistive tech', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 3 },
    })
    const cells = wrapper.findAll('.weekstart-cell')
    cells.forEach((cell, i) => {
      expect(cell.attributes('aria-checked')).toBe(i === 3 ? 'true' : 'false')
    })
  })

  it('emits set-week-start with the numeric day index on cell click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const cells = wrapper.findAll('.weekstart-cell')
    // Friday (index 5)
    await cells[5]!.trigger('click')
    expect(wrapper.emitted('set-week-start')![0]).toEqual([5])
    // Saturday (index 6)
    await cells[6]!.trigger('click')
    expect(wrapper.emitted('set-week-start')![1]).toEqual([6])
  })

  it('shows the resolved day name in the weekstart caption', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 3 },
    })
    const cap = wrapper.find('.weekstart-caption')
    expect(cap.text()).toContain('Wednesday')
  })

  it('renders a help affordance for every setting label', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    // Screenshots Folder, Data Location, Engine, Theme, First Day
    // of Week, Export, Import, Grafana stream, Clear DB. The last
    // four live inside the closed <details> but are still in the DOM.
    expect(wrapper.findAll('.setting-help')).toHaveLength(9)
  })
})

// ── Engine section (Tesseract) ───────────────────────────────────────────

import type { TesseractStatus } from '../api'

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
    loading: false,
    themeMode: 'dark' as const,
    weekStart: 0 as const,
    tesseractReady: true,
    tesseractSupported: true,
    tesseractStatus: readyTesseract(),
    tesseractPickerBusy: false,
  }

  it('shows the engine-status panel as "Detected" when Tesseract is ready', () => {
    const wrapper = mount(SettingsView, { props: baseEngineProps })
    const status = wrapper.find('.engine-status')
    expect(status.exists()).toBe(true)
    expect(status.classes()).toContain('ok')
    expect(status.text()).toContain('Detected')
  })

  it('marks the row as alert + status fail when Tesseract is not ready', () => {
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, { props: baseEngineProps })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Binary'))!
    await btn.trigger('click')
    expect(wrapper.emitted('pick-tesseract')).toBeTruthy()
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
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
      props: baseEngineProps,
    })
    const btn = findEngineBtn(wrapper, 'Detect')!
    expect(btn).toBeDefined()
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits detect-tesseract when the Detect button is clicked while not ready', async () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseEngineProps,
        tesseractReady: false,
        tesseractStatus: readyTesseract({ found: false }),
      },
    })
    const btn = findEngineBtn(wrapper, 'Detect')!
    await btn.trigger('click')
    expect(wrapper.emitted('detect-tesseract')).toBeTruthy()
  })

  it('emits reset-tesseract when the Reset button is clicked', async () => {
    const wrapper = mount(SettingsView, {
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
    expect(wrapper.emitted('reset-tesseract')).toBeTruthy()
  })

  it('disables Reset when the configured path is already the platform default', () => {
    const wrapper = mount(SettingsView, {
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
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
    tesseractReady: true, tesseractSupported: true, tesseractPickerBusy: false,
  }

  it('shows only the macOS Homebrew paths when platform=darwin', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'darwin' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('/opt/homebrew/bin')
    expect(desc.text()).toContain('/usr/local/bin')
    expect(desc.text()).not.toContain('Program Files')
    expect(desc.text()).not.toContain('/usr/bin')
  })

  it('shows only the Linux apt path when platform=linux', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseEngineProps, tesseractStatus: readyTesseract({ platform: 'linux' }) },
    })
    const desc = wrapper.find('.engine-row .setting-desc')
    expect(desc.text()).toContain('/usr/bin')
    expect(desc.text()).not.toContain('Program Files')
    expect(desc.text()).not.toContain('/opt/homebrew/bin')
  })

  it('shows only the Windows Program Files path when platform=windows', () => {
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
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
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders both JSON and CSV format buttons', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const json = wrapper.findAll('button').find(b => b.text().trim() === 'JSON')
    const csv  = wrapper.findAll('button').find(b => b.text().trim() === 'CSV')
    expect(json).toBeDefined()
    expect(csv).toBeDefined()
  })

  it('emits export-data when the JSON button is clicked', async () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const json = wrapper.findAll('button').find(b => b.text().trim() === 'JSON')!
    await json.trigger('click')
    expect(wrapper.emitted('export-data')).toBeTruthy()
  })

  it('emits export-data-csv when the CSV button is clicked', async () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const csv = wrapper.findAll('button').find(b => b.text().trim() === 'CSV')!
    await csv.trigger('click')
    expect(wrapper.emitted('export-data-csv')).toBeTruthy()
  })

  it('shows "Saving…" on the JSON button while exporting="json" and disables both', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, exporting: 'json' },
    })
    const saving = wrapper.findAll('button').find(b => b.text().includes('Saving'))!
    expect(saving.attributes('disabled')).toBeDefined()
    const csv = wrapper.findAll('button').find(b => b.text().trim() === 'CSV')!
    expect(csv.attributes('disabled')).toBeDefined()
  })

  it('renders the success chip when exportStatus.ok is true', () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseProps,
        exportStatus: { ok: true, message: 'Saved: /tmp/recall.json' },
      },
    })
    expect(wrapper.text()).toContain('Saved: /tmp/recall.json')
    expect(wrapper.find('.setting-meta.success').exists()).toBe(true)
  })

  it('renders the failure chip when exportStatus.ok is false', () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseProps,
        exportStatus: { ok: false, message: 'Export failed: boom' },
      },
    })
    expect(wrapper.text()).toContain('Export failed: boom')
    expect(wrapper.find('.setting-meta.blocked').exists()).toBe(true)
  })

  it('shows the unarmed "Import Backup…" button by default', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Import Backup'))!
    expect(btn).toBeDefined()
    expect(btn.classes()).toContain('danger-outline')
  })

  it('arms / confirms / cancels the Import flow', async () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const arm = wrapper.findAll('button').find(b => b.text().includes('Import Backup'))!
    await arm.trigger('click')
    expect(wrapper.emitted('arm-import')).toBeTruthy()

    await wrapper.setProps({ importArmed: true, matchedCount: 5 })
    const choose = wrapper.findAll('button').find(b => b.text().includes('Choose File'))!
    expect(choose).toBeDefined()
    expect(wrapper.text()).toMatch(/wipes 5 record/)

    await choose.trigger('click')
    expect(wrapper.emitted('import-data')).toBeTruthy()

    const cancel = wrapper.findAll('button').find(b => b.text().trim() === 'Cancel')!
    await cancel.trigger('click')
    expect(wrapper.emitted('cancel-import')).toBeTruthy()
  })

  it('disables Import while exporting (and vice versa)', () => {
    const exporting = mount(SettingsView, {
      props: { ...baseProps, exporting: 'json' },
    })
    const importBtn = exporting.findAll('button').find(b => b.text().includes('Import Backup'))!
    expect(importBtn.attributes('disabled')).toBeDefined()

    const importing = mount(SettingsView, {
      props: { ...baseProps, importing: true },
    })
    const json = importing.findAll('button').find(b => b.text().trim() === 'JSON')!
    expect(json.attributes('disabled')).toBeDefined()
  })
})

// ── Advanced collapsible (Grafana + Clear DB) ────────────────────────────

describe('SettingsView — Advanced section', () => {
  const baseProps = {
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the Advanced <details> closed by default', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const det = wrapper.find('details.advanced-section')
    expect(det.exists()).toBe(true)
    expect((det.element as HTMLDetailsElement).open).toBe(false)
  })

  it('renders the Grafana toggle inside the Advanced section', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const det = wrapper.find('details.advanced-section')
    expect(det.text()).toContain('Stream to Grafana')
  })

  it('emits toggle-prometheus when the Grafana switch changes', async () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    // The big-switch checkbox is inside the (closed but rendered) <details>.
    const cb = wrapper.find('details.advanced-section input[type="checkbox"]')
    await cb.trigger('change')
    expect(wrapper.emitted('toggle-prometheus')).toBeTruthy()
  })

  it('arms Clear Database, confirms delete, then cancels', async () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, matchedCount: 4, unknownCount: 0 },
    })
    const arm = wrapper.findAll('button').find(b => b.text().includes('Clear Database'))!
    await arm.trigger('click')
    expect(wrapper.emitted('arm-clear')).toBeTruthy()

    await wrapper.setProps({ clearConfirm: true, matchedCount: 4, unknownCount: 0 })
    const del = wrapper.findAll('button').find(b => b.text().includes('Delete 4 Records'))!
    expect(del).toBeDefined()
    await del.trigger('click')
    expect(wrapper.emitted('clear-database')).toBeTruthy()

    const cancel = wrapper.findAll('button').find(b => b.text().trim() === 'Cancel')!
    await cancel.trigger('click')
    expect(wrapper.emitted('cancel-clear')).toBeTruthy()
  })

  it('disables Clear Database when no records exist', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, matchedCount: 0, unknownCount: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Clear Database'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })
})

// ── Data Location row (Directories section) ──────────────────────────────

describe('SettingsView — Data Location row', () => {
  const baseProps = {
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }
  const sampleLoc = {
    base_dir: '/data',
    settings_path: '/data/settings.json',
    database_path: '/data/db/recall.db',
    screenshots_dir: '/srv',
  }

  it('renders both paths when dataLocation is populated', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const grid = wrapper.find('.data-loc-grid')
    expect(grid.exists()).toBe(true)
    expect(grid.text()).toContain('/data/db/recall.db')
    expect(grid.text()).toContain('/data/settings.json')
  })

  it('hides the path grid when dataLocation is null but still shows the label', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, dataLocation: null },
    })
    expect(wrapper.text()).toContain('Data Location')
    expect(wrapper.find('.data-loc-grid').exists()).toBe(false)
  })

  it('renders a Copy button per path row', () => {
    const wrapper = mount(SettingsView, {
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

    const wrapper = mount(SettingsView, {
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

    const wrapper = mount(SettingsView, {
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
      const wrapper = mount(SettingsView, {
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

    const wrapper = mount(SettingsView, {
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

// ── Detect Overwatch Folder — empty-state hero + steady-state row ──────

describe('SettingsView — Detect Overwatch Folder (empty state hero)', () => {
  const emptyProps = {
    screenshotsDir: '', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the Auto-Detect Folder primary CTA in the empty-state hero', () => {
    const wrapper = mount(SettingsView, { props: emptyProps })
    const detect = wrapper.findAll('button').find(b => b.text().includes('Auto-Detect Folder'))
    expect(detect).toBeDefined()
    expect(detect!.classes()).toContain('primary')
    expect(detect!.attributes('disabled')).toBeUndefined()
  })

  it('emits detect-screenshots-dir when Auto-Detect is clicked', async () => {
    const wrapper = mount(SettingsView, { props: emptyProps })
    const detect = wrapper.findAll('button').find(b => b.text().includes('Auto-Detect Folder'))!
    await detect.trigger('click')
    expect(wrapper.emitted('detect-screenshots-dir')).toBeTruthy()
  })

  it('emits pick-screenshots-dir when "Choose Manually" is clicked', async () => {
    const wrapper = mount(SettingsView, { props: emptyProps })
    const manual = wrapper.findAll('button').find(b => b.text().includes('Choose Manually'))!
    await manual.trigger('click')
    expect(wrapper.emitted('pick-screenshots-dir')).toBeTruthy()
  })

  it('shows the in-flight label and disables Auto-Detect while probing=true', () => {
    const wrapper = mount(SettingsView, {
      props: { ...emptyProps, probing: true },
    })
    const detect = wrapper.findAll('button').find(b => b.text().includes('Detecting'))!
    expect(detect.attributes('disabled')).toBeDefined()
  })
})

describe('SettingsView — steady-state row affordances', () => {
  const setProps = {
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders a Detect button alongside Change… in the steady-state row', () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')
    expect(detect).toBeDefined()
  })

  // Detect renders but stays disabled when a folder is set — the
  // user must Reset first to re-enable auto-detection. Confirmed
  // emit-side: a click on a disabled button produces no event.
  it('keeps the steady-state Detect button disabled', () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')!
    expect(detect.attributes('disabled')).toBeDefined()
  })

  it('emits reveal-screenshots-dir when Reveal is clicked', async () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const reveal = wrapper.findAll('button').find(b => b.text().trim() === 'Reveal')!
    await reveal.trigger('click')
    expect(wrapper.emitted('reveal-screenshots-dir')).toBeTruthy()
  })

  it('emits reset-screenshots-dir when Reset is clicked', async () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const reset = wrapper.findAll('button').find(b => b.text().trim() === 'Reset')!
    await reset.trigger('click')
    expect(wrapper.emitted('reset-screenshots-dir')).toBeTruthy()
  })
})

describe('SettingsView — Probe chip', () => {
  const emptyProps = {
    screenshotsDir: '', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the success chip when probeStatus=success', () => {
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, { props: emptyProps })
    expect(wrapper.find('.probe-chip').exists()).toBe(false)
  })

  it('dismisses the chip when the close × is clicked', async () => {
    const wrapper = mount(SettingsView, {
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
    const wrapper = mount(SettingsView, {
      props: {
        ...emptyProps,
        probeStatus: 'blocked',
        probeMessage: 'No default on this machine.',
      },
    })
    await wrapper.find('.probe-chip-close').trigger('click')
    expect(wrapper.find('.probe-chip').exists()).toBe(false)

    await wrapper.setProps({
      probeStatus: 'success',
      probeMessage: 'Detected · /path',
    })
    expect(wrapper.find('.probe-chip').exists()).toBe(true)
  })
})

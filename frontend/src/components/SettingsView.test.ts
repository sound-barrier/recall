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

  it('emits toggle-theme when the inactive theme swatch is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    // themeMode === 'dark', so clicking the light swatch should toggle.
    const lightSwatch = wrapper.find('.light-swatch')
    await lightSwatch.trigger('click')
    expect(wrapper.emitted('toggle-theme')).toBeTruthy()
  })

  it('does not emit toggle-theme when the active swatch is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    // Clicking the dark swatch when dark is already active is a no-op.
    await wrapper.find('.dark-swatch').trigger('click')
    expect(wrapper.emitted('toggle-theme')).toBeFalsy()
  })

  it('marks the active theme swatch per themeMode prop', () => {
    const dark = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(dark.find('.dark-swatch').classes()).toContain('active')
    expect(dark.find('.light-swatch').classes()).not.toContain('active')

    const light = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'light', weekStart: 0 },
    })
    expect(light.find('.light-swatch').classes()).toContain('active')
    expect(light.find('.dark-swatch').classes()).not.toContain('active')
  })

  it('aria-checked mirrors themeMode on each swatch', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.find('.dark-swatch').attributes('aria-checked')).toBe('true')
    expect(wrapper.find('.light-swatch').attributes('aria-checked')).toBe('false')
  })

  it('emits go-to-view ingest when the "Ingest →" link is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Ingest'))!
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
    // Screenshots Folder, Data Location, Theme, First Day of Week.
    expect(wrapper.findAll('.setting-help')).toHaveLength(4)
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

describe('SettingsView — Detect Overwatch Folder (steady state)', () => {
  const setProps = {
    screenshotsDir: '/srv', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders a Detect button alongside Change… in the steady-state row', () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')
    expect(detect).toBeDefined()
  })

  it('emits detect-screenshots-dir when the steady-state Detect is clicked', async () => {
    const wrapper = mount(SettingsView, { props: setProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')!
    await detect.trigger('click')
    expect(wrapper.emitted('detect-screenshots-dir')).toBeTruthy()
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

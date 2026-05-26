import { describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsView from './SettingsView.vue'

describe('SettingsView', () => {
  it('shows the "choose a folder to begin" heading when no folder is selected', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Choose a')
    expect(wrapper.text()).toContain('screenshots folder')
    // The dash placeholder appears for the value.
    expect(wrapper.find('.setting-value').text()).toBe('— Not selected —')
  })

  it('shows the "where Recall reads from" heading once a folder is configured', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv/owmetrics', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Where Recall reads from')
    expect(wrapper.find('.setting-value').text()).toBe('/srv/owmetrics')
  })

  it('emits pick-screenshots-dir when Change Folder is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('pick-screenshots-dir')).toBeTruthy()
  })

  it('disables Change Folder while loading=true', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: true, themeMode: 'dark', weekStart: 0 },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits toggle-theme on theme button click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    await wrapper.find('.theme-toggle').trigger('click')
    expect(wrapper.emitted('toggle-theme')).toBeTruthy()
  })

  it('marks the active theme segment per themeMode prop', () => {
    const dark = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const darkSegs = dark.findAll('.theme-seg')
    // Order in template: Day (light) first, Night (dark) second.
    expect(darkSegs[1]!.classes()).toContain('active')
    expect(darkSegs[0]!.classes()).not.toContain('active')

    const light = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'light', weekStart: 0 },
    })
    const lightSegs = light.findAll('.theme-seg')
    expect(lightSegs[0]!.classes()).toContain('active')
    expect(lightSegs[1]!.classes()).not.toContain('active')
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

  // ── Calendar section: First Day of Week 7-segment picker ───────

  it('renders the Calendar section with all seven day segments and full day names', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    expect(wrapper.text()).toContain('Calendar')
    expect(wrapper.text()).toContain('First Day of Week')
    const segs = wrapper.findAll('.weekstart-seg')
    expect(segs).toHaveLength(7)
    // Full day names — no abbreviations.
    const expectedNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    expectedNames.forEach((name, i) => {
      expect(segs[i]!.text()).toContain(name)
    })
  })

  it('marks the active weekstart segment per weekStart prop (any day 0-6)', () => {
    for (let day = 0; day <= 6; day++) {
      const wrapper = mount(SettingsView, {
        props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: day as 0 | 1 | 2 | 3 | 4 | 5 | 6 },
      })
      const segs = wrapper.findAll('.weekstart-seg')
      segs.forEach((seg, i) => {
        if (i === day) expect(seg.classes()).toContain('active')
        else expect(seg.classes()).not.toContain('active')
      })
    }
  })

  it('aria-checked mirrors weekStart for assistive tech', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 3 },
    })
    const segs = wrapper.findAll('.weekstart-seg')
    segs.forEach((seg, i) => {
      expect(seg.attributes('aria-checked')).toBe(i === 3 ? 'true' : 'false')
    })
  })

  it('emits set-week-start with the numeric day index on segment click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 0 },
    })
    const segs = wrapper.findAll('.weekstart-seg')
    // Friday (index 5)
    await segs[5]!.trigger('click')
    expect(wrapper.emitted('set-week-start')![0]).toEqual([5])
    // Saturday (index 6)
    await segs[6]!.trigger('click')
    expect(wrapper.emitted('set-week-start')![1]).toEqual([6])
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

  it('disables the Copy DB Path button when no dataLocation is loaded yet', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, dataLocation: null },
    })
    const copyBtn = wrapper.findAll('button').find(b => b.text().includes('Copy DB Path'))!
    expect(copyBtn.attributes('disabled')).toBeDefined()
  })

  it('writes the database path to the clipboard when Copy DB Path is clicked', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const wrapper = mount(SettingsView, {
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const copyBtn = wrapper.findAll('button').find(b => b.text().includes('Copy DB Path'))!
    await copyBtn.trigger('click')
    expect(writeText).toHaveBeenCalledWith('/data/db/recall.db')
  })

  it('flashes "Copied ✓" after a successful copy and clears after 1.4 s', async () => {
    vi.useFakeTimers()
    try {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        configurable: true,
      })
      const wrapper = mount(SettingsView, {
        props: { ...baseProps, dataLocation: sampleLoc },
      })
      const copyBtn = wrapper.findAll('button').find(b => b.text().includes('Copy DB Path'))!
      await copyBtn.trigger('click')
      // Resolve the writeText microtask first.
      await Promise.resolve()
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).toContain('Copied ✓')

      // Bar clears 1.4 s later.
      vi.advanceTimersByTime(1500)
      await wrapper.vm.$nextTick()
      expect(wrapper.text()).not.toContain('Copied ✓')
      expect(wrapper.text()).toContain('Copy DB Path')
    } finally {
      vi.useRealTimers()
    }
  })

  it('falls back to a prompt() when the Clipboard API rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    // happy-dom doesn't ship a window.prompt — stub it as a global so
    // the component's `window.prompt(...)` call hits our spy.
    const promptSpy = vi.fn().mockReturnValue(null)
    vi.stubGlobal('prompt', promptSpy)

    const wrapper = mount(SettingsView, {
      props: { ...baseProps, dataLocation: sampleLoc },
    })
    const copyBtn = wrapper.findAll('button').find(b => b.text().includes('Copy DB Path'))!
    await copyBtn.trigger('click')
    // Let the rejected promise + catch land.
    await Promise.resolve()
    await Promise.resolve()
    expect(promptSpy).toHaveBeenCalledWith('Copy this path:', '/data/db/recall.db')
    vi.unstubAllGlobals()
  })
})

// ── Detect Overwatch Folder row ─────────────────────────────────────────

describe('SettingsView — Detect Overwatch Folder', () => {
  const baseProps = {
    screenshotsDir: '', loading: false, themeMode: 'dark' as const, weekStart: 0 as const,
  }

  it('renders the Detect button alongside Change Folder', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')
    expect(detect).toBeDefined()
    expect(detect!.attributes('disabled')).toBeUndefined()
  })

  it('emits detect-screenshots-dir when Detect is clicked', async () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    const detect = wrapper.findAll('button').find(b => b.text().trim() === 'Detect')!
    await detect.trigger('click')
    expect(wrapper.emitted('detect-screenshots-dir')).toBeTruthy()
  })

  it('shows the in-flight label and disables the button while probing=true', () => {
    const wrapper = mount(SettingsView, {
      props: { ...baseProps, probing: true },
    })
    const detect = wrapper.findAll('button').find(b => b.text().includes('Detecting'))!
    expect(detect.attributes('disabled')).toBeDefined()
  })

  it('renders the success chip when probeStatus=success', () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseProps,
        probeStatus: 'success',
        probeMessage: 'Detected · /home/u/Documents/Overwatch/ScreenShots/Overwatch',
      },
    })
    const chip = wrapper.find('.setting-meta')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('success')
    expect(chip.text()).toContain('Detected')
  })

  it('renders the blocked chip + Looked-in disclosure when probeStatus=blocked', () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: ['/a/path', '/b/path'],
      },
    })
    const chip = wrapper.find('.setting-meta')
    expect(chip.classes()).toContain('blocked')

    const details = wrapper.find('.probe-tried')
    expect(details.exists()).toBe(true)
    const items = wrapper.findAll('.probe-tried-list li')
    expect(items).toHaveLength(2)
    expect(items[0]!.text()).toBe('/a/path')
    expect(items[1]!.text()).toBe('/b/path')
  })

  it('hides the Looked-in disclosure when probeTried is empty even on the blocked path', () => {
    const wrapper = mount(SettingsView, {
      props: {
        ...baseProps,
        probeStatus: 'blocked',
        probeMessage: 'No default Overwatch folder on this machine.',
        probeTried: [],
      },
    })
    expect(wrapper.find('.probe-tried').exists()).toBe(false)
  })

  it('renders no chip at all when probeMessage is empty', () => {
    const wrapper = mount(SettingsView, { props: baseProps })
    expect(wrapper.find('.setting-meta').exists()).toBe(false)
  })
})

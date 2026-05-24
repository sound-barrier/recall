import { describe, expect, it } from 'vitest'
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

import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsView from './SettingsView.vue'

describe('SettingsView', () => {
  it('shows the "choose a folder to begin" heading when no folder is selected', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    expect(wrapper.text()).toContain('Choose a')
    expect(wrapper.text()).toContain('screenshots folder')
    // The dash placeholder appears for the value.
    expect(wrapper.find('.setting-value').text()).toBe('— Not selected —')
  })

  it('shows the "where Recall reads from" heading once a folder is configured', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv/owmetrics', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    expect(wrapper.text()).toContain('Where Recall reads from')
    expect(wrapper.find('.setting-value').text()).toBe('/srv/owmetrics')
  })

  it('emits pick-screenshots-dir when Change Folder is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('pick-screenshots-dir')).toBeTruthy()
  })

  it('disables Change Folder while loading=true', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: true, themeMode: 'dark', weekStart: 'sunday' },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits toggle-theme on theme button click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    await wrapper.find('.theme-toggle').trigger('click')
    expect(wrapper.emitted('toggle-theme')).toBeTruthy()
  })

  it('marks the active theme segment per themeMode prop', () => {
    const dark = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const darkSegs = dark.findAll('.theme-seg')
    // Order in template: Day (light) first, Night (dark) second.
    expect(darkSegs[1]!.classes()).toContain('active')
    expect(darkSegs[0]!.classes()).not.toContain('active')

    const light = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'light', weekStart: 'sunday' },
    })
    const lightSegs = light.findAll('.theme-seg')
    expect(lightSegs[0]!.classes()).toContain('active')
    expect(lightSegs[1]!.classes()).not.toContain('active')
  })

  it('emits go-to-view ingest when the "Ingest →" link is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Ingest'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['ingest'])
  })

  // ── Calendar section: First Day of Week toggle ─────────────────

  it('renders the Calendar section with both Sun and Mon segments', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    expect(wrapper.text()).toContain('Calendar')
    expect(wrapper.text()).toContain('First Day of Week')
    const segs = wrapper.findAll('.weekstart-seg')
    expect(segs).toHaveLength(2)
    expect(segs[0]!.text()).toContain('Sun')
    expect(segs[1]!.text()).toContain('Mon')
  })

  it('marks the active weekstart segment per weekStart prop', () => {
    const sun = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const sunSegs = sun.findAll('.weekstart-seg')
    expect(sunSegs[0]!.classes()).toContain('active')
    expect(sunSegs[1]!.classes()).not.toContain('active')

    const mon = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'monday' },
    })
    const monSegs = mon.findAll('.weekstart-seg')
    expect(monSegs[0]!.classes()).not.toContain('active')
    expect(monSegs[1]!.classes()).toContain('active')
  })

  it('aria-checked mirrors weekStart for assistive tech', () => {
    const sun = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const segs = sun.findAll('.weekstart-seg')
    expect(segs[0]!.attributes('aria-checked')).toBe('true')
    expect(segs[1]!.attributes('aria-checked')).toBe('false')
  })

  it('emits set-week-start with the chosen day on segment click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark', weekStart: 'sunday' },
    })
    const segs = wrapper.findAll('.weekstart-seg')
    await segs[1]!.trigger('click') // click Mon
    expect(wrapper.emitted('set-week-start')).toBeTruthy()
    expect(wrapper.emitted('set-week-start')![0]).toEqual(['monday'])

    await segs[0]!.trigger('click') // click Sun
    expect(wrapper.emitted('set-week-start')![1]).toEqual(['sunday'])
  })
})

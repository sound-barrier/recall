import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import SettingsView from './SettingsView.vue'

describe('SettingsView', () => {
  it('shows the "choose a folder to begin" heading when no folder is selected', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '', loading: false, themeMode: 'dark' },
    })
    expect(wrapper.text()).toContain('Choose a')
    expect(wrapper.text()).toContain('screenshots folder')
    // The dash placeholder appears for the value.
    expect(wrapper.find('.setting-value').text()).toBe('— Not selected —')
  })

  it('shows the "where Recall reads from" heading once a folder is configured', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv/owmetrics', loading: false, themeMode: 'dark' },
    })
    expect(wrapper.text()).toContain('Where Recall reads from')
    expect(wrapper.find('.setting-value').text()).toBe('/srv/owmetrics')
  })

  it('emits pick-screenshots-dir when Change Folder is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark' },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))
    expect(btn).toBeDefined()
    await btn!.trigger('click')
    expect(wrapper.emitted('pick-screenshots-dir')).toBeTruthy()
  })

  it('disables Change Folder while loading=true', () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: true, themeMode: 'dark' },
    })
    const btn = wrapper.findAll('button').find(b => b.text().includes('Change Folder'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('emits toggle-theme on theme button click', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark' },
    })
    await wrapper.find('.theme-toggle').trigger('click')
    expect(wrapper.emitted('toggle-theme')).toBeTruthy()
  })

  it('marks the active theme segment per themeMode prop', () => {
    const dark = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark' },
    })
    const darkSegs = dark.findAll('.theme-seg')
    // Order in template: Day (light) first, Night (dark) second.
    expect(darkSegs[1]!.classes()).toContain('active')
    expect(darkSegs[0]!.classes()).not.toContain('active')

    const light = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'light' },
    })
    const lightSegs = light.findAll('.theme-seg')
    expect(lightSegs[0]!.classes()).toContain('active')
    expect(lightSegs[1]!.classes()).not.toContain('active')
  })

  it('emits go-to-view ingest when the "Ingest →" link is clicked', async () => {
    const wrapper = mount(SettingsView, {
      props: { screenshotsDir: '/srv', loading: false, themeMode: 'dark' },
    })
    const link = wrapper.findAll('.empty-link').find(el => el.text().includes('Ingest'))!
    await link.trigger('click')
    expect(wrapper.emitted('go-to-view')).toBeTruthy()
    expect(wrapper.emitted('go-to-view')![0]).toEqual(['ingest'])
  })
})

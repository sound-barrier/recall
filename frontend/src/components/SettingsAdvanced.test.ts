// SettingsAdvanced — Manage-ignored row + Clear-Database opt-out
// checkbox. The Grafana big-switch + the arm/confirm two-step on
// Clear were already covered by SettingsView.test.ts; the cases
// below pin behavior the new props/emits introduced.

import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'

// Mock ../api so the useOWData session-singleton fetch (added when
// the Supported capture-source rules collapsible landed) doesn't
// try to reach localhost:3000 at module-load time. Returning a
// stub matches the real GetOWData shape so useOWData populates
// data.value with the empty defaults.
vi.mock('../api', () => ({
  GetOWData: vi.fn(async () => ({
    heroes_by_role:     {},
    maps_by_type:       {},
    screenshot_sources: [],
  })),
}))

import SettingsAdvanced from './SettingsAdvanced.vue'

function mountAdvanced(overrides: Partial<{
  prometheusEnabled: boolean
  clearConfirm:      boolean
  matchedCount:      number
  unknownCount:      number
  ignoredCount:      number
}> = {}) {
  return mount(SettingsAdvanced, {
    props: {
      prometheusEnabled: overrides.prometheusEnabled ?? false,
      clearConfirm:      overrides.clearConfirm ?? false,
      matchedCount:      overrides.matchedCount ?? 5,
      unknownCount:      overrides.unknownCount ?? 0,
      ignoredCount:      overrides.ignoredCount ?? 0,
    },
    attachTo: document.body,
  })
}

describe('SettingsAdvanced — Manage ignored row', () => {
  it('Manage button is disabled when ignoredCount is 0', () => {
    const wrapper = mountAdvanced({ ignoredCount: 0 })
    const btn = wrapper.findAll('button').find(b => b.text().startsWith('Manage'))!
    expect(btn.attributes('disabled')).toBeDefined()
  })

  it('Manage button is enabled and emits open-ignored-panel when ignoredCount > 0', async () => {
    const wrapper = mountAdvanced({ ignoredCount: 3 })
    const btn = wrapper.findAll('button').find(b => b.text().startsWith('Manage'))!
    expect(btn.attributes('disabled')).toBeUndefined()
    await btn.trigger('click')
    expect(wrapper.emitted('open-ignored-panel')).toBeTruthy()
  })

  it('Description reads "haven\'t deleted any" when ignoredCount is 0', () => {
    const wrapper = mountAdvanced({ ignoredCount: 0 })
    expect(wrapper.text()).toContain("haven't deleted any screenshots forever yet")
  })

  it('Description reads "N file(s) currently skipped" when ignoredCount > 0', () => {
    const wrapper = mountAdvanced({ ignoredCount: 7 })
    expect(wrapper.text()).toContain('7 files currently skipped')
  })
})

describe('SettingsAdvanced — Clear Database opt-out checkbox', () => {
  it('Opt-out checkbox is HIDDEN when clearConfirm is true but ignoredCount is 0', () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 0 })
    expect(wrapper.find('.clear-keep-ignored').exists()).toBe(false)
  })

  it('Opt-out checkbox renders in the arm step when ignoredCount > 0', () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 4 })
    const label = wrapper.find('.clear-keep-ignored')
    expect(label.exists()).toBe(true)
    expect(label.text()).toContain('Keep the 4 ignored screenshots')
    const checkbox = label.find('input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false) // default unchecked
  })

  it('Singular wording when ignoredCount === 1', () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 1 })
    expect(wrapper.find('.clear-keep-ignored').text()).toContain('Keep the 1 ignored screenshot ')
  })

  it('Confirm emits clear-database with { keepIgnored: false } by default', async () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 3 })
    const confirmBtn = wrapper.findAll('button').find(b => b.text().startsWith('Delete '))!
    await confirmBtn.trigger('click')
    expect(wrapper.emitted('clear-database')).toEqual([[{ keepIgnored: false }]])
  })

  it('Checking the box and confirming emits with { keepIgnored: true }', async () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 3 })
    const checkbox = wrapper.find('.clear-keep-ignored input[type="checkbox"]')
    await checkbox.setValue(true)
    const confirmBtn = wrapper.findAll('button').find(b => b.text().startsWith('Delete '))!
    await confirmBtn.trigger('click')
    expect(wrapper.emitted('clear-database')).toEqual([[{ keepIgnored: true }]])
  })

  it('Opt-out checkbox resets to false when the arm is re-opened', async () => {
    const wrapper = mountAdvanced({ clearConfirm: true, ignoredCount: 3 })
    await wrapper.find('.clear-keep-ignored input[type="checkbox"]').setValue(true)
    // Simulate the parent toggling clearConfirm off then on again
    // (user clicked Cancel, then re-armed). The checkbox must reset.
    await wrapper.setProps({ clearConfirm: false })
    await wrapper.setProps({ clearConfirm: true })
    const checkbox = wrapper.find('.clear-keep-ignored input[type="checkbox"]')
    expect((checkbox.element as HTMLInputElement).checked).toBe(false)
  })
})

describe('SettingsAdvanced — re-parse progress line (item 12)', () => {
  it('renders nothing when parseProgress carries no re-parse counters', () => {
    const wrapper = mount(SettingsAdvanced, {
      props: {
        prometheusEnabled: false,
        parseProgress: { done: 5, total: 47, filename: 'x.png' },
      },
    })
    expect(wrapper.find('[data-reparse-progress-line]').exists()).toBe(false)
  })

  it('renders the cumulative counters when the SSE event carries them', async () => {
    const wrapper = mount(SettingsAdvanced, {
      props: {
        prometheusEnabled: false,
        reparsing: true,
        parseProgress: {
          done: 47,
          total: 47,
          filename: 'x.png',
          matches_updated: 12,
          hero_corrections: 3,
          map_corrections: 1,
        },
      },
    })
    const line = wrapper.find('[data-reparse-progress-line]')
    expect(line.exists()).toBe(true)
    expect(line.text()).toContain('12 of 47 matches updated')
    expect(line.text()).toContain('3 hero / 1 map corrected')
  })

  it('omits the corrections suffix when neither hero nor map fields changed', () => {
    const wrapper = mount(SettingsAdvanced, {
      props: {
        prometheusEnabled: false,
        reparsing: true,
        parseProgress: {
          done: 47,
          total: 47,
          filename: 'x.png',
          matches_updated: 12,
          hero_corrections: 0,
          map_corrections: 0,
        },
      },
    })
    const line = wrapper.find('[data-reparse-progress-line]')
    expect(line.text()).toContain('12 of 47 matches updated')
    expect(line.text()).not.toContain('corrected')
  })
})

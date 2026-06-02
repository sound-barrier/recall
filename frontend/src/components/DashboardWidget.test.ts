import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardWidget from './DashboardWidget.vue'

describe('DashboardWidget', () => {
  it('renders a <div class="kpi-tile"> for shape=kpi with data-widget-id', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi' },
      slots: { default: '<span class="payload">x</span>' },
    })
    const root = w.find('[data-widget-id="winrate"]')
    expect(root.exists()).toBe(true)
    expect(root.element.tagName).toBe('DIV')
    expect(root.classes()).toContain('kpi-tile')
    expect(w.find('.payload').exists()).toBe(true)
  })

  it('renders an <article class="breakdown"> for shape=breakdown', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-maps', shape: 'breakdown' },
    })
    const root = w.find('[data-widget-id="top-maps"]')
    expect(root.element.tagName).toBe('ARTICLE')
    expect(root.classes()).toContain('breakdown')
  })

  it('emits the legacy data-kpi attr when legacyDataKpi is set', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'reviewed-count', shape: 'kpi', legacyDataKpi: 'reviewed-count' },
    })
    expect(w.find('[data-kpi="reviewed-count"]').exists()).toBe(true)
    expect(w.find('[data-widget-id="reviewed-count"]').exists()).toBe(true)
  })

  it('omits data-kpi when legacyDataKpi is unset', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi' },
    })
    expect(w.find('[data-kpi]').exists()).toBe(false)
  })

  it('emits the legacy data-breakdown attr when legacyDataBreakdown is set', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-roles', shape: 'breakdown', legacyDataBreakdown: 'roles' },
    })
    expect(w.find('[data-breakdown="roles"]').exists()).toBe(true)
  })
})

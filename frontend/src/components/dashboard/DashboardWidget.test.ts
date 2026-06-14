import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardWidget from '@/components/dashboard/DashboardWidget.vue'

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

  // No edit mode: the drag handle + trash are ALWAYS in the DOM (CSS
  // hover-reveals them), so manage controls are one gesture away with
  // no mode to enter first.
  it('always renders the drag handle and trash button', () => {
    const w = mount(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    expect(w.find('[data-drag-handle="winrate"]').exists()).toBe(true)
    expect(w.find('[data-widget-remove="winrate"]').exists()).toBe(true)
  })

  it('is draggable so reorder works without a mode', () => {
    const w = mount(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    expect(w.find('[data-widget-id="winrate"]').attributes('draggable')).toBe('true')
  })

  it('clicking the trash button emits remove(id)', async () => {
    const w = mount(DashboardWidget, { props: { id: 'winrate', shape: 'kpi' } })
    await w.find('[data-widget-remove="winrate"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
    expect(w.emitted('remove')![0]).toEqual(['winrate'])
  })

  it('applies dashboard-widget-dragging when the dragging prop flips', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', dragging: false },
    })
    const root = w.find('[data-widget-id="winrate"]')
    expect(root.classes()).not.toContain('dashboard-widget-dragging')
    await w.setProps({ dragging: true })
    expect(root.classes()).toContain('dashboard-widget-dragging')
  })

  it('applies dashboard-widget-drop-target when dropTarget flips', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', dropTarget: false },
    })
    const root = w.find('[data-widget-id="winrate"]')
    expect(root.classes()).not.toContain('dashboard-widget-drop-target')
    await w.setProps({ dropTarget: true })
    expect(root.classes()).toContain('dashboard-widget-drop-target')
  })

  // The gear is gated only by a non-empty config schema (hasConfig) —
  // settings are a read-time concern, independent of layout edits.
  it('renders the gear button only when hasConfig is true', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true },
    })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').exists()).toBe(true)
    await w.setProps({ hasConfig: false })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').exists()).toBe(false)
  })

  it('clicking the gear emits configure(id, event)', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true },
    })
    await w.find('[data-widget-config-trigger="top-heroes"]').trigger('click')
    const configure = w.emitted('configure')
    expect(configure).toBeTruthy()
    expect(configure![0]![0]).toBe('top-heroes')
  })

  it('forwards handle keydown for keyboard reorder', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', row: 1, idx: 0 },
    })
    await w.find('[data-drag-handle="winrate"]').trigger('keydown', { key: 'ArrowRight' })
    expect(w.emitted('handle-keydown')).toBeTruthy()
    expect(w.emitted('handle-keydown')![0]![0]).toBe('winrate')
  })
})

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

  it('renders the trash button whenever editMode is on (hover-revealed via CSS, present in DOM)', async () => {
    // The edit-UX polish PR moves trash from "selection-gated" to
    // "always-present-in-edit-mode" so users can one-click-remove
    // without first having to click-select. CSS hover-reveals it for
    // mouse users; selection keeps it visible without hover.
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: true, selected: false },
    })
    expect(w.find('[data-widget-remove="winrate"]').exists()).toBe(true)
    await w.setProps({ selected: true })
    expect(w.find('[data-widget-remove="winrate"]').exists()).toBe(true)
    await w.setProps({ editMode: false, selected: true })
    expect(w.find('[data-widget-remove="winrate"]').exists()).toBe(false)
  })

  it('applies dashboard-widget-dragging when the dragging prop flips', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: true, dragging: false },
    })
    const root = w.find('[data-widget-id="winrate"]')
    expect(root.classes()).not.toContain('dashboard-widget-dragging')
    await w.setProps({ dragging: true })
    expect(root.classes()).toContain('dashboard-widget-dragging')
  })

  it('clicking the root in editMode emits select(id)', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: true },
    })
    await w.find('[data-widget-id="winrate"]').trigger('click')
    expect(w.emitted('select')).toBeTruthy()
    expect(w.emitted('select')![0]).toEqual(['winrate'])
  })

  it('clicking the root outside editMode does NOT emit select', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: false },
    })
    await w.find('[data-widget-id="winrate"]').trigger('click')
    expect(w.emitted('select')).toBeFalsy()
  })

  it('clicking the trash button emits remove(id) and does not bubble select', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: true, selected: true },
    })
    await w.find('[data-widget-remove="winrate"]').trigger('click')
    expect(w.emitted('remove')).toBeTruthy()
    expect(w.emitted('remove')![0]).toEqual(['winrate'])
    expect(w.emitted('select')).toBeFalsy()
  })

  it('selected adds the .dashboard-widget-selected class in editMode', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', editMode: true, selected: true },
    })
    expect(w.find('[data-widget-id="winrate"]').classes()).toContain('dashboard-widget-selected')
  })

  // Settings live on their own axis from layout edits: the gear is
  // visible whenever the widget has a non-empty config schema,
  // regardless of editMode / selection. Edit mode is for moving
  // widgets; the gear is for tuning what one shows.
  it('renders the gear button whenever hasConfig is true, regardless of editMode', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true, editMode: false },
    })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').exists()).toBe(true)
    await w.setProps({ editMode: true, selected: false })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').exists()).toBe(true)
    await w.setProps({ editMode: true, selected: true })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').exists()).toBe(true)
  })

  it('omits the gear button when hasConfig is false', () => {
    const w = mount(DashboardWidget, {
      props: { id: 'winrate', shape: 'kpi', hasConfig: false, editMode: true, selected: true },
    })
    expect(w.find('[data-widget-config-trigger="winrate"]').exists()).toBe(false)
  })

  // In edit mode the trash button claims the right edge as the
  // destructive control, so the gear shifts left via the
  // .dashboard-gear-inset modifier. Outside edit mode there's no
  // trash, so the gear sits at the corner.
  it('shifts the gear inset when editMode is on so the trash keeps the right edge', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true, editMode: false },
    })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').classes()).not.toContain('dashboard-gear-inset')
    await w.setProps({ editMode: true })
    expect(w.find('[data-widget-config-trigger="top-heroes"]').classes()).toContain('dashboard-gear-inset')
  })

  it('clicking the gear emits configure(id, event) and does not bubble select', async () => {
    const w = mount(DashboardWidget, {
      props: { id: 'top-heroes', shape: 'breakdown', hasConfig: true, editMode: true, selected: true },
    })
    await w.find('[data-widget-config-trigger="top-heroes"]').trigger('click')
    const configure = w.emitted('configure')
    expect(configure).toBeTruthy()
    expect(configure![0]![0]).toBe('top-heroes')
    expect(w.emitted('select')).toBeFalsy()
  })
})

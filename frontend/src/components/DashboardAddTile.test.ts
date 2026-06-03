import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardAddTile from './DashboardAddTile.vue'

describe('DashboardAddTile', () => {
  it('renders a button with the accessible label, glyph, and label copy', () => {
    const w = mount(DashboardAddTile)
    const btn = w.find('button[data-add-tile]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toBe('Add a widget to the dashboard')
    expect(w.find('.dashboard-add-tile-glyph').text()).toBe('+')
    expect(w.find('.dashboard-add-tile-label').text()).toBe('Add widget')
  })

  it('emits click on click', async () => {
    const w = mount(DashboardAddTile)
    await w.find('button[data-add-tile]').trigger('click')
    expect(w.emitted('click')).toBeTruthy()
  })
})

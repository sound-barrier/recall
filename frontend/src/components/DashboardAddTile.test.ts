import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardAddTile from './DashboardAddTile.vue'

describe('DashboardAddTile', () => {
  it('renders a button with the accessible label', () => {
    const w = mount(DashboardAddTile)
    const btn = w.find('button[data-add-tile]')
    expect(btn.exists()).toBe(true)
    expect(btn.attributes('aria-label')).toBe('Add a widget to the dashboard')
    expect(btn.text()).toBe('+')
  })

  it('emits click on click', async () => {
    const w = mount(DashboardAddTile)
    await w.find('button[data-add-tile]').trigger('click')
    expect(w.emitted('click')).toBeTruthy()
  })
})

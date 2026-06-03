import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DashboardEditBanner from './DashboardEditBanner.vue'

describe('DashboardEditBanner', () => {
  it('renders nothing when open=false', () => {
    const w = mount(DashboardEditBanner, { props: { open: false } })
    expect(w.find('.dashboard-edit-banner').exists()).toBe(false)
  })

  it('renders the status text + helper + exit button when open=true', () => {
    const w = mount(DashboardEditBanner, { props: { open: true } })
    expect(w.find('.dashboard-edit-banner').exists()).toBe(true)
    expect(w.find('.dashboard-edit-banner-label').text()).toMatch(/editing/i)
    expect(w.find('[data-edit-banner-exit]').exists()).toBe(true)
  })

  it('emits exit when the Done button is clicked', async () => {
    const w = mount(DashboardEditBanner, { props: { open: true } })
    await w.find('[data-edit-banner-exit]').trigger('click')
    expect(w.emitted('exit')).toBeTruthy()
  })
})

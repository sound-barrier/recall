import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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

  describe('Reset button (two-step inline confirm)', () => {
    beforeEach(() => { vi.useFakeTimers() })
    afterEach(() => { vi.useRealTimers() })

    it('renders the Reset button when open=true', () => {
      const w = mount(DashboardEditBanner, { props: { open: true } })
      const btn = w.find('[data-edit-banner-reset]')
      expect(btn.exists()).toBe(true)
      expect(btn.text()).toMatch(/reset/i)
    })

    it('first click arms confirm mode but does NOT emit reset', async () => {
      const w = mount(DashboardEditBanner, { props: { open: true } })
      await w.find('[data-edit-banner-reset]').trigger('click')
      // Button copy flips to a confirmation prompt; emission deferred.
      expect(w.find('[data-edit-banner-reset]').text()).toMatch(/confirm/i)
      expect(w.emitted('reset')).toBeFalsy()
    })

    it('second click within the window emits reset and disarms', async () => {
      const w = mount(DashboardEditBanner, { props: { open: true } })
      await w.find('[data-edit-banner-reset]').trigger('click')
      await w.find('[data-edit-banner-reset]').trigger('click')
      expect(w.emitted('reset')).toBeTruthy()
      expect(w.emitted('reset')!.length).toBe(1)
      // After the emit, the button returns to its idle copy.
      expect(w.find('[data-edit-banner-reset]').text()).toMatch(/^reset$/i)
    })

    it('arms then auto-disarms after the timeout if no confirm', async () => {
      const w = mount(DashboardEditBanner, { props: { open: true } })
      await w.find('[data-edit-banner-reset]').trigger('click')
      expect(w.find('[data-edit-banner-reset]').text()).toMatch(/confirm/i)
      // Past the 3s confirm window.
      vi.advanceTimersByTime(3100)
      await w.vm.$nextTick()
      expect(w.find('[data-edit-banner-reset]').text()).toMatch(/^reset$/i)
      expect(w.emitted('reset')).toBeFalsy()
    })

    it('closing the banner (open=false) cancels an armed confirm', async () => {
      const w = mount(DashboardEditBanner, { props: { open: true } })
      await w.find('[data-edit-banner-reset]').trigger('click')
      await w.setProps({ open: false })
      await w.setProps({ open: true })
      // Re-opens in idle state.
      expect(w.find('[data-edit-banner-reset]').text()).toMatch(/^reset$/i)
    })
  })
})

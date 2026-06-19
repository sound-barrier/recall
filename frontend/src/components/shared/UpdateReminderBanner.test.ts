import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

import UpdateReminderBanner from '@/components/shared/UpdateReminderBanner.vue'
import { useAppStore } from '@/stores/app'
import type { UpdateInfo } from '@/api'

// The banner now owns the whole reminder feature (useUpdateReminder derives the
// gate + day-count from the app store's updateInfo), so these seed updateInfo —
// the raw input — and assert the rendered result, rather than passing the
// already-derived open/days props.
const DAY = 24 * 60 * 60 * 1000
const isoDaysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString()

function mountWith(last_checked_at: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const appStore = useAppStore()
  appStore.updateInfo = { checked: true, current: '1.0.0', latest: '1.0.0', last_checked_at } as unknown as UpdateInfo
  // Spy before mount — the component destructures checkForUpdates at setup.
  const checkSpy = vi.spyOn(appStore, 'checkForUpdates').mockResolvedValue(undefined)
  const wrapper = mount(UpdateReminderBanner, { global: { plugins: [pinia] } })
  return { wrapper, appStore, checkSpy }
}

describe('UpdateReminderBanner', () => {
  beforeEach(() => { globalThis.localStorage?.clear() })

  it('renders the "Last checked N days ago" copy when the last check is 90+ days old', () => {
    const { wrapper } = mountWith(isoDaysAgo(92))
    expect(wrapper.text()).toContain('Last checked 92 days ago')
  })

  it('renders the "never checked" copy when last_checked_at is unset', () => {
    const { wrapper } = mountWith('')
    expect(wrapper.text()).toContain("haven't checked")
  })

  it('drives the app-store update check when "Check now" is clicked', async () => {
    const { wrapper, checkSpy } = mountWith(isoDaysAgo(100))
    await wrapper.find('[data-update-reminder-check]').trigger('click')
    expect(checkSpy).toHaveBeenCalledOnce()
  })

  it('hides itself once the × dismiss is clicked', async () => {
    const { wrapper } = mountWith(isoDaysAgo(100))
    expect(wrapper.find('.update-reminder-banner').exists()).toBe(true)
    await wrapper.find('[data-update-reminder-dismiss]').trigger('click')
    expect(wrapper.find('.update-reminder-banner').exists()).toBe(false)
  })

  it('stays hidden when the last check is within the 90-day window', () => {
    const { wrapper } = mountWith(isoDaysAgo(10))
    expect(wrapper.find('.update-reminder-banner').exists()).toBe(false)
  })
})

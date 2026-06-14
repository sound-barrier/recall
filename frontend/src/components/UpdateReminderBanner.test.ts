import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import UpdateReminderBanner from '@/components/UpdateReminderBanner.vue'

describe('UpdateReminderBanner', () => {
  it('renders the "Last checked N days ago" copy when daysSinceLastCheck is set', () => {
    const wrapper = mount(UpdateReminderBanner, {
      props: { open: true, daysSinceLastCheck: 92 },
    })
    expect(wrapper.text()).toContain('Last checked 92 days ago')
  })

  it('renders the "never checked" copy when daysSinceLastCheck is null', () => {
    const wrapper = mount(UpdateReminderBanner, {
      props: { open: true, daysSinceLastCheck: null },
    })
    expect(wrapper.text()).toContain("haven't checked")
  })

  it('emits check when the "Check now" button is clicked', async () => {
    const wrapper = mount(UpdateReminderBanner, {
      props: { open: true, daysSinceLastCheck: 100 },
    })
    await wrapper.find('[data-update-reminder-check]').trigger('click')
    expect(wrapper.emitted('check')).toHaveLength(1)
  })

  it('emits dismiss when the × button is clicked', async () => {
    const wrapper = mount(UpdateReminderBanner, {
      props: { open: true, daysSinceLastCheck: 100 },
    })
    await wrapper.find('[data-update-reminder-dismiss]').trigger('click')
    expect(wrapper.emitted('dismiss')).toHaveLength(1)
  })

  it('does not render the banner element when open is false', () => {
    const wrapper = mount(UpdateReminderBanner, {
      props: { open: false, daysSinceLastCheck: 100 },
    })
    expect(wrapper.find('.update-reminder-banner').exists()).toBe(false)
  })
})

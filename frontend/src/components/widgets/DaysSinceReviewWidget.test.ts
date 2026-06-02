import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import DaysSinceReviewWidget from './DaysSinceReviewWidget.vue'

describe('DaysSinceReviewWidget', () => {
  it('renders em-dash when no review has happened', () => {
    const w = mount(DaysSinceReviewWidget, {
      props: { daysSinceLastReview: { days: null, lastReviewedAt: null } },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders "Today" when the last review was less than 24 hours ago', () => {
    const w = mount(DaysSinceReviewWidget, {
      props: { daysSinceLastReview: { days: 0, lastReviewedAt: '2026-06-02T10:00:00Z' } },
    })
    expect(w.find('.kpi-value').text()).toBe('Today')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the day count with "days ago" subtitle', () => {
    const w = mount(DaysSinceReviewWidget, {
      props: { daysSinceLastReview: { days: 4, lastReviewedAt: '2026-05-29T10:00:00Z' } },
    })
    expect(w.find('.kpi-value').text()).toBe('4')
    expect(w.find('.kpi-sub').text()).toMatch(/^days ago$/)
  })

  it('singular "day ago" when exactly 1', () => {
    const w = mount(DaysSinceReviewWidget, {
      props: { daysSinceLastReview: { days: 1, lastReviewedAt: '2026-06-01T10:00:00Z' } },
    })
    expect(w.find('.kpi-sub').text()).toMatch(/^day ago$/)
  })

  it('puts the ISO timestamp in the value title attr', () => {
    const w = mount(DaysSinceReviewWidget, {
      props: { daysSinceLastReview: { days: 2, lastReviewedAt: '2026-05-31T10:00:00Z' } },
    })
    expect(w.find('.kpi-value').attributes('title')).toBe('2026-05-31T10:00:00Z')
  })
})

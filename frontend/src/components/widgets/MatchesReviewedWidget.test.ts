import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import MatchesReviewedWidget from './MatchesReviewedWidget.vue'

describe('MatchesReviewedWidget', () => {
  it('renders em-dash when no matches in the narrow', () => {
    const w = mount(MatchesReviewedWidget, {
      props: { reviewedCount: { reviewed: 0, total: 0, percent: 0 } },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the reviewed count and a percentage subtitle', () => {
    const w = mount(MatchesReviewedWidget, {
      props: { reviewedCount: { reviewed: 23, total: 47, percent: 49 } },
    })
    expect(w.find('.kpi-value').text()).toBe('23')
    expect(w.find('.kpi-sub').text()).toMatch(/49% of 47 matches/)
  })

  it('singular "match" when total is 1', () => {
    const w = mount(MatchesReviewedWidget, {
      props: { reviewedCount: { reviewed: 1, total: 1, percent: 100 } },
    })
    expect(w.find('.kpi-sub').text()).toMatch(/100% of 1 match$/)
  })
})

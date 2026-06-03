import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LongestWinStreakWidget from './LongestWinStreakWidget.vue'

describe('LongestWinStreakWidget', () => {
  it('renders an em-dash when no win streak exists', () => {
    const w = mount(LongestWinStreakWidget, { props: { count: 0 } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the streak count with a "wins" subtitle when > 1', () => {
    const w = mount(LongestWinStreakWidget, { props: { count: 7 } })
    expect(w.find('.kpi-value').text()).toBe('7')
    expect(w.find('.kpi-sub').text().trim()).toBe('wins')
  })

  it('singularises the subtitle when count === 1', () => {
    const w = mount(LongestWinStreakWidget, { props: { count: 1 } })
    expect(w.find('.kpi-value').text()).toBe('1')
    expect(w.find('.kpi-sub').text().trim()).toBe('win')
  })
})

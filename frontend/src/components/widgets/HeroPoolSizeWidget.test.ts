import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import HeroPoolSizeWidget from './HeroPoolSizeWidget.vue'

describe('HeroPoolSizeWidget', () => {
  it('renders an em-dash when no heroes have been played', () => {
    const w = mount(HeroPoolSizeWidget, { props: { size: 0 } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the count with the "unique heroes" subtitle', () => {
    const w = mount(HeroPoolSizeWidget, { props: { size: 12 } })
    expect(w.find('.kpi-value').text()).toBe('12')
    expect(w.find('.kpi-sub').text()).toContain('unique heroes')
  })

  it('singularises the subtitle when size === 1', () => {
    const w = mount(HeroPoolSizeWidget, { props: { size: 1 } })
    expect(w.find('.kpi-value').text()).toBe('1')
    expect(w.find('.kpi-sub').text().trim()).toBe('unique hero')
  })
})

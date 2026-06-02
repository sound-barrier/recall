import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import WinrateWidget from './WinrateWidget.vue'

describe('WinrateWidget', () => {
  it('renders the winrate as a percentage when set', () => {
    const w = mount(WinrateWidget, { props: { winrate: 67 } })
    expect(w.text()).toContain('67%')
  })

  it('renders an em-dash when winrate is null (no decisive matches)', () => {
    const w = mount(WinrateWidget, { props: { winrate: null } })
    expect(w.find('.kpi-value').text()).toBe('—')
  })

  it('handles 0% without falling back to em-dash', () => {
    const w = mount(WinrateWidget, { props: { winrate: 0 } })
    expect(w.find('.kpi-value').text()).toBe('0%')
  })
})

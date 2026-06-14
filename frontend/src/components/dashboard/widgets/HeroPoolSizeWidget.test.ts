import { describe, it, expect } from 'vitest'
import HeroPoolSizeWidget from '@/components/dashboard/widgets/HeroPoolSizeWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('HeroPoolSizeWidget', () => {
  it('renders an em-dash when no heroes have been played', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPoolSize: 0 } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the count with the "unique heroes" subtitle', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPoolSize: 12 } })
    expect(w.find('.kpi-value').text()).toBe('12')
    expect(w.find('.kpi-sub').text()).toContain('unique heroes')
  })

  it('singularises the subtitle when size === 1', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPoolSize: 1 } })
    expect(w.find('.kpi-value').text()).toBe('1')
    expect(w.find('.kpi-sub').text().trim()).toBe('unique hero')
  })
})

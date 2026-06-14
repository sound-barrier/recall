import { describe, it, expect } from 'vitest'
import WinrateWidget from '@/components/widgets/WinrateWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('WinrateWidget', () => {
  it('renders the winrate as a percentage when set', () => {
    const w = mountWidget(WinrateWidget, { dossier: { winrate: 67 } })
    expect(w.text()).toContain('67%')
  })

  it('renders an em-dash when winrate is null (no decisive matches)', () => {
    const w = mountWidget(WinrateWidget, { dossier: { winrate: null } })
    expect(w.find('.kpi-value').text()).toBe('—')
  })

  it('handles 0% without falling back to em-dash', () => {
    const w = mountWidget(WinrateWidget, { dossier: { winrate: 0 } })
    expect(w.find('.kpi-value').text()).toBe('0%')
  })
})

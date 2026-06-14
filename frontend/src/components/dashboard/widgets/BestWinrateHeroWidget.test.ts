import { describe, it, expect } from 'vitest'
import BestWinrateHeroWidget from '@/components/dashboard/widgets/BestWinrateHeroWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('BestWinrateHeroWidget', () => {
  it('renders an em-dash when no hero qualifies', () => {
    const w = mountWidget(BestWinrateHeroWidget, { dossier: { bestWinrateHero: null } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders the hero name + "N% in M matches" sub when the hero qualifies', () => {
    const w = mountWidget(BestWinrateHeroWidget, {
      dossier: { bestWinrateHero: { key: 'lucio', winrate: 83, qualifyingMatches: 6 } },
    })
    expect(w.find('.kpi-value').text()).toBe('lucio')
    expect(w.find('.kpi-sub').text()).toContain('83%')
    expect(w.find('.kpi-sub').text()).toContain('6 matches')
  })

  it('singularises the sub when qualifyingMatches === 1', () => {
    const w = mountWidget(BestWinrateHeroWidget, {
      dossier: { bestWinrateHero: { key: 'ana', winrate: 100, qualifyingMatches: 1 } },
    })
    expect(w.find('.kpi-sub').text()).toContain('1 match')
    expect(w.find('.kpi-sub').text()).not.toContain('matches')
  })
})

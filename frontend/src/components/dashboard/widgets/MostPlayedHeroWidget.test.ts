import { describe, it, expect } from 'vitest'
import MostPlayedHeroWidget from '@/components/dashboard/widgets/MostPlayedHeroWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const hero = (key: string, share: number, winrate: number, timeLabel = '5h0min', totalMinutes = 300) => ({
  key, share, winrate, timeLabel, totalMinutes,
})

describe('MostPlayedHeroWidget', () => {
  it('renders the top-ranked hero name', () => {
    const w = mountWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', 60, 55), hero('mercy', 40, 50)],
        mostPlayedHero: { key: 'lucio', winrate: 55, qualifyingMatches: 3 },
      },
    })
    expect(w.find('.kpi-value').text()).toBe('lucio')
  })

  it('renders em-dash when topHeroesByMinutes is empty', () => {
    const w = mountWidget(MostPlayedHeroWidget, {
      dossier: { topHeroesByMinutes: [], mostPlayedHero: null },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('shows winrate-and-count subtitle when mostPlayedHero has decisive matches', () => {
    const w = mountWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', 60, 55)],
        mostPlayedHero: { key: 'lucio', winrate: 67, qualifyingMatches: 3 },
      },
    })
    expect(w.find('.kpi-sub').text()).toMatch(/67% in 3 matches/)
  })

  it('singular "match" when qualifyingMatches is 1', () => {
    const w = mountWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', 60, 100)],
        mostPlayedHero: { key: 'lucio', winrate: 100, qualifyingMatches: 1 },
      },
    })
    expect(w.find('.kpi-sub').text()).toMatch(/100% in 1 match$/)
  })

  it('hides subtitle when winrate is null (no decisive qualifying matches)', () => {
    const w = mountWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', 60, 0)],
        mostPlayedHero: { key: 'lucio', winrate: null, qualifyingMatches: 0 },
      },
    })
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

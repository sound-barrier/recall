import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import MostPlayedHeroWidget from '@/components/dashboard/widgets/MostPlayedHeroWidget.vue'
import { renderWidget } from '@/test-utils'

const hero = (key: string, stats: { share: number; winrate: number }) => ({
  key, ...stats, timeLabel: '5h0min', totalMinutes: 300,
})

describe('MostPlayedHeroWidget', () => {
  it('renders the top-ranked hero name', () => {
    renderWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', { share: 60, winrate: 55 }), hero('mercy', { share: 40, winrate: 50 })],
        mostPlayedHero: { key: 'lucio', winrate: 55, qualifyingMatches: 3 },
      },
    })
    expect(screen.getByText('lucio')).toBeInTheDocument()
  })

  it('renders em-dash when topHeroesByMinutes is empty', () => {
    renderWidget(MostPlayedHeroWidget, {
      dossier: { topHeroesByMinutes: [], mostPlayedHero: null },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/% in/)).not.toBeInTheDocument()
  })

  it('shows winrate-and-count subtitle when mostPlayedHero has decisive matches', () => {
    renderWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', { share: 60, winrate: 55 })],
        mostPlayedHero: { key: 'lucio', winrate: 67, qualifyingMatches: 3 },
      },
    })
    // The sub pluralizes via a nested <span>es</span>, so anchor on the
    // element's own text and assert the full rendered content.
    expect(screen.getByText(/67% in 3 match/)).toHaveTextContent(/67% in 3 matches/)
  })

  it('singular "match" when qualifyingMatches is 1', () => {
    renderWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', { share: 60, winrate: 100 })],
        mostPlayedHero: { key: 'lucio', winrate: 100, qualifyingMatches: 1 },
      },
    })
    expect(screen.getByText(/100% in 1 match/)).toHaveTextContent(/100% in 1 match$/)
  })

  it('hides subtitle when winrate is null (no decisive qualifying matches)', () => {
    renderWidget(MostPlayedHeroWidget, {
      dossier: {
        topHeroesByMinutes: [hero('lucio', { share: 60, winrate: 0 })],
        mostPlayedHero: { key: 'lucio', winrate: null, qualifyingMatches: 0 },
      },
    })
    expect(screen.queryByText(/% in/)).not.toBeInTheDocument()
  })
})

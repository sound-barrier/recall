import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import BestWinrateHeroWidget from '@/components/dashboard/widgets/BestWinrateHeroWidget.vue'
import { renderWidget } from '@/test-utils'

describe('BestWinrateHeroWidget', () => {
  it('renders an em-dash when no hero qualifies', () => {
    renderWidget(BestWinrateHeroWidget, { dossier: { bestWinrateHero: null } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/% in/)).not.toBeInTheDocument()
  })

  it('renders the hero name + "N% in M matches" sub when the hero qualifies', () => {
    renderWidget(BestWinrateHeroWidget, {
      dossier: { bestWinrateHero: { key: 'lucio', winrate: 83, qualifyingMatches: 6 } },
    })
    expect(screen.getByText('lucio')).toBeInTheDocument()
    // The sub pluralizes via a nested <span>es</span>, so anchor on the
    // element's own text and assert the full rendered content.
    expect(screen.getByText(/83% in 6 match/)).toHaveTextContent('83% in 6 matches')
  })

  it('singularizes the sub when qualifyingMatches === 1', () => {
    renderWidget(BestWinrateHeroWidget, {
      dossier: { bestWinrateHero: { key: 'ana', winrate: 100, qualifyingMatches: 1 } },
    })
    expect(screen.getByText(/100% in 1 match/)).toHaveTextContent(/^100% in 1 match$/)
  })
})

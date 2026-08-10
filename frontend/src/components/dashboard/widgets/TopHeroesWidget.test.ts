import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import TopHeroesWidget from '@/components/dashboard/widgets/TopHeroesWidget.vue'
import { renderWidget } from '@/test-utils'

const hero = (key: string, stats: { totalMinutes: number; share: number; timeLabel: string }) => ({
  key, ...stats, winrate: 50,
})

describe('TopHeroesWidget', () => {
  it('renders one row per hero with the time-label inside the bar', () => {
    renderWidget(TopHeroesWidget, {
      dossier: {
        topHeroesByMinutes: [
          hero('lucio', { totalMinutes: 452, share: 60, timeLabel: '7h32min' }),
          hero('mercy', { totalMinutes: 180, share: 24, timeLabel: '3h0min' }),
        ],
      },
    })
    // Height-filler placeholders are aria-hidden, so the role query
    // sees only real rows.
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('lucio')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('7h32min')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('60%')).toBeInTheDocument()
  })

  it('renders the eyebrow label', () => {
    renderWidget(TopHeroesWidget, { dossier: { topHeroesByMinutes: [] } })
    expect(screen.getByText('Most played heroes')).toBeInTheDocument()
  })
})

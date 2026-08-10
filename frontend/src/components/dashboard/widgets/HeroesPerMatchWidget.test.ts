import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'

import HeroesPerMatchWidget from '@/components/dashboard/widgets/HeroesPerMatchWidget.vue'
import { renderWidget } from '@/test-utils'

const BUCKETS = [
  { key: '1 hero', heroes: 1, total: 13, wins: 9, decisive: 13, winrate: 69, lowSample: false },
  { key: '2 heroes', heroes: 2, total: 4, wins: 1, decisive: 4, winrate: 25, lowSample: true },
]

describe('HeroesPerMatchWidget', () => {
  it('renders one row per bucket with count, winrate bar, and low-sample tag', () => {
    renderWidget(HeroesPerMatchWidget, { dossier: { heroCountBuckets: BUCKETS } })
    expect(screen.getByText('Heroes per match')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('1 hero')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('13x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('69%')).toBeInTheDocument()
    // The winrate bar communicates only through its width style — no
    // text or role to query.
    // eslint-disable-next-line testing-library/no-node-access -- style-only winrate bar has no accessible surface
    expect(rows[0]!.querySelector('.bd-fill')?.getAttribute('style')).toContain('69%')
    expect(within(rows[0]!).queryByText('n<5')).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText('n<5')).toBeInTheDocument()
  })

  it('shows a placeholder when no bucket exists', () => {
    renderWidget(HeroesPerMatchWidget, { dossier: { heroCountBuckets: [] } })
    expect(screen.getByText(/No matches/)).toBeInTheDocument()
  })
})

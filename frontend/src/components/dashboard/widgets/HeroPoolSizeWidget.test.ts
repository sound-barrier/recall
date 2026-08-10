import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import HeroPoolSizeWidget from '@/components/dashboard/widgets/HeroPoolSizeWidget.vue'
import { renderWidget } from '@/test-utils'

const EMPTY_SPLIT = { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } }

function pool(keys: string[]) {
  return {
    pool: keys.map((key, i) => ({ key, role: 'support', total: 10 - i, wins: 5, losses: 4, winrate: 55, lowSample: false })),
    split: EMPTY_SPLIT,
    outHeroes: [],
  }
}

describe('HeroPoolSizeWidget', () => {
  it('renders an em-dash and an invitation when no pool derives', () => {
    renderWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool([]) } })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText(/no pool yet/)).toBeInTheDocument()
  })

  it('shows the derived pool size with the member roster as the subtitle', () => {
    renderWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool(['lucio', 'brig']) } })
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('lucio, brig')).toBeInTheDocument()
  })

  it('truncates a large roster to three names plus a count', () => {
    renderWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool(['a', 'b', 'c', 'd', 'e']) } })
    expect(screen.getByText('5')).toBeInTheDocument()
    expect(screen.getByText('a, b, c +2')).toHaveAttribute('title', 'a, b, c, d, e')
  })
})

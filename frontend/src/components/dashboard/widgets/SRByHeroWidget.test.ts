import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import SRByHeroWidget from '@/components/dashboard/widgets/SRByHeroWidget.vue'
import { renderWidget } from '@/test-utils'

describe('SRByHeroWidget', () => {
  it('splits the movement by the hero that earned it', () => {
    // One net figure can read flat while a support climbed and a tank slid.
    renderWidget(SRByHeroWidget, {
      dossier: {
        srByHero: [
          { hero: 'ana', net: 50, latest: 2525, readCount: 2 },
          { hero: 'reinhardt', net: -20, latest: 2100, readCount: 1 },
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('ana')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('+50 · 2525')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('-20 · 2100')).toBeInTheDocument()
  })

  it('puts the movement in the meter, scaled against the largest', () => {
    renderWidget(SRByHeroWidget, {
      dossier: {
        srByHero: [
          { hero: 'ana', net: 50, latest: 2525, readCount: 2 },
          { hero: 'reinhardt', net: -20, latest: 2100, readCount: 1 },
        ],
      },
    })
    expect(screen.getByRole('progressbar', { name: 'ana SR movement — up' }))
      .toHaveAttribute('aria-valuenow', '50')
    // Magnitude, not sign — a slide of 20 is a bar of 20.
    expect(screen.getByRole('progressbar', { name: 'reinhardt SR movement — down' }))
      .toHaveAttribute('aria-valuenow', '20')
  })

  it('says so when no match reported SR', () => {
    renderWidget(SRByHeroWidget, { dossier: { srByHero: [] } })
    expect(screen.getByText('No SR readings in this set.')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

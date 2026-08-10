import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import CurrentRankWidget from '@/components/dashboard/widgets/CurrentRankWidget.vue'
import { renderWidget } from '@/test-utils'

describe('CurrentRankWidget', () => {
  it('renders the latest rank per role', () => {
    renderWidget(CurrentRankWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'platinum', level: 1, progress: 60 },
          { key: 'dps', label: 'DPS', tier: 'gold', level: 3, progress: 20 },
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Tank')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('platinum 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('60%')).toBeInTheDocument()
    // The bar fill clamps the within-division progress to width %.
    // eslint-disable-next-line testing-library/no-node-access -- style-only progress bar has no accessible surface
    expect(rows[0]!.querySelector('.bd-fill')?.getAttribute('style')).toContain('60%')
  })

  it('clamps a negative (demotion) progress to a non-negative bar width', () => {
    const { baseElement } = renderWidget(CurrentRankWidget, {
      dossier: { currentRank: [{ key: 'tank', label: 'Tank', tier: 'gold', level: 1, progress: -19 }] },
    })
    // eslint-disable-next-line testing-library/no-node-access -- style-only progress bar has no accessible surface
    expect(baseElement.querySelector('.bd-fill')?.getAttribute('style')).toContain('0%')
    expect(screen.getByText('-19%')).toBeInTheDocument()
  })

  it('shows an empty state when there are no rank readings', () => {
    renderWidget(CurrentRankWidget, { dossier: { currentRank: [] } })
    expect(screen.getByText(/No rank readings yet/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

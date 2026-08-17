import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import CurrentRankWidget from '@/components/dashboard/widgets/CurrentRankWidget.vue'
import { renderWidget } from '@/test-utils'

describe('CurrentRankWidget', () => {
  it('renders the latest rank per role', () => {
    renderWidget(CurrentRankWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'platinum', level: 1, progress: 60, percentile: 62 },
          { key: 'dps', label: 'DPS', tier: 'gold', level: 3, progress: 20, percentile: 38 },
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('Tank')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('platinum 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('60%')).toBeInTheDocument()
    // Within-division progress is a progressbar meter named for the role
    // line; the percentage lives in aria-valuenow.
    expect(screen.getByRole('progressbar', { name: 'Tank progress' }))
      .toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByRole('progressbar', { name: 'DPS progress' }))
      .toHaveAttribute('aria-valuenow', '20')
  })

  it('clamps a negative (demotion) progress to a non-negative meter value', () => {
    renderWidget(CurrentRankWidget, {
      dossier: { currentRank: [{ key: 'tank', label: 'Tank', tier: 'gold', level: 1, progress: -19, percentile: null }] },
    })
    // aria-valuenow reports the same clamped quantity the bar paints.
    expect(screen.getByRole('progressbar', { name: 'Tank progress' }))
      .toHaveAttribute('aria-valuenow', '0')
    expect(screen.getByText('-19%')).toBeInTheDocument()
  })

  it('shows an empty state when there are no rank readings', () => {
    renderWidget(CurrentRankWidget, { dossier: { currentRank: [] } })
    expect(screen.getByText(/No rank readings yet/)).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

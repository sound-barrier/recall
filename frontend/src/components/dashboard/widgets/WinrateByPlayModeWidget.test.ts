import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import WinrateByPlayModeWidget from '@/components/dashboard/widgets/WinrateByPlayModeWidget.vue'
import { renderWidget } from '@/test-utils'

const entry = (key: string, total: number, winrate: number, share = 0) => ({ key, total, share, winrate })

describe('WinrateByPlayModeWidget', () => {
  it('renders three rows with winrate as the bar metric and bd-time as match count', () => {
    renderWidget(WinrateByPlayModeWidget, {
      dossier: {
        playModeBreakdown: [
          entry('quickplay',   23, 65),
          entry('competitive', 245, 51),
          entry('—',           14, 35),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)

    expect(within(rows[0]!).getByText('quickplay')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('65%')).toBeInTheDocument()
    // The bar is a meter over winrate, not share — that's what
    // separates this widget from QuickplayVsCompetitive.
    expect(screen.getByRole('progressbar', { name: 'quickplay winrate' }))
      .toHaveAttribute('aria-valuenow', '65')
    // The count overlay carries the sample size so the user can read
    // significance.
    expect(within(rows[0]!).getByText('23x')).toBeInTheDocument()

    expect(screen.getByRole('progressbar', { name: 'competitive winrate' }))
      .toHaveAttribute('aria-valuenow', '51')
    expect(within(rows[2]!).getByText('35%')).toBeInTheDocument()
  })

  it('renders the eyebrow label', () => {
    renderWidget(WinrateByPlayModeWidget, { dossier: { playModeBreakdown: [] } })
    expect(screen.getByText('Winrate by play mode')).toBeInTheDocument()
  })
})

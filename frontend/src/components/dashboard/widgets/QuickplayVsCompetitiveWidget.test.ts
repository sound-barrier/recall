import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import QuickplayVsCompetitiveWidget from '@/components/dashboard/widgets/QuickplayVsCompetitiveWidget.vue'
import { renderWidget } from '@/test-utils'

const entry = (key: string, total: number, share: number, winrate = 50) => ({ key, total, share, winrate })

describe('QuickplayVsCompetitiveWidget', () => {
  it('renders three fixed rows (qp / comp / unset) with share as the bar metric', () => {
    renderWidget(QuickplayVsCompetitiveWidget, {
      dossier: {
        playModeBreakdown: [
          entry('quickplay',   23, 8),
          entry('competitive', 245, 87),
          entry('—',           14, 5),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)

    expect(within(rows[0]!).getByText('quickplay')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('23x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('8%')).toBeInTheDocument()
    // The share bar communicates only through its width style — no
    // text or role to query.
    // eslint-disable-next-line testing-library/no-node-access -- style-only share bar has no accessible surface
    expect((rows[0]!.querySelector('.bd-fill') as HTMLElement).style.width).toBe('8%')

    expect(within(rows[1]!).getByText('competitive')).toBeInTheDocument()
    // eslint-disable-next-line testing-library/no-node-access -- style-only share bar has no accessible surface
    expect((rows[1]!.querySelector('.bd-fill') as HTMLElement).style.width).toBe('87%')

    expect(within(rows[2]!).getByText('—')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('5%')).toBeInTheDocument()
  })

  it('renders the eyebrow label', () => {
    renderWidget(QuickplayVsCompetitiveWidget, { dossier: { playModeBreakdown: [] } })
    expect(screen.getByText('Quickplay vs Competitive')).toBeInTheDocument()
  })

  it('renders empty when the dossier feeds an empty slice', () => {
    renderWidget(QuickplayVsCompetitiveWidget, { dossier: { playModeBreakdown: [] } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

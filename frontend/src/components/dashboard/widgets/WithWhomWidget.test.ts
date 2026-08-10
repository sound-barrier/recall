import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import WithWhomWidget from '@/components/dashboard/widgets/WithWhomWidget.vue'
import { renderWidget } from '@/test-utils'

const entry = (key: string, total: number, winrate: number, share = 50) => ({ key, total, winrate, share })

describe('WithWhomWidget', () => {
  it('renders one row per teammate: name, win-rate bar + stat, count overlay', () => {
    renderWidget(WithWhomWidget, {
      dossier: { withWhomBreakdown: [entry('Alice', 3, 67), entry('Bob', 2, 50), entry('Solo', 1, 100)] },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('Alice')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('3x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('67%')).toBeInTheDocument()
    // The meter reports WIN RATE (the comparison axis), not share — one
    // per teammate, named for the teammate, in rank order.
    expect(screen.getByRole('progressbar', { name: 'Alice winrate' }))
      .toHaveAttribute('aria-valuenow', '67')
    expect(screen.getAllByRole('progressbar').map((b) => b.getAttribute('aria-valuenow')))
      .toEqual(['67', '50', '100'])
  })

  it('shows the teach-me empty state when no teammates are tagged', () => {
    renderWidget(WithWhomWidget, { dossier: { withWhomBreakdown: [] } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    expect(screen.getByText(/tag teammates/i)).toBeInTheDocument()
  })

  it('renders the eyebrow label', () => {
    renderWidget(WithWhomWidget, { dossier: { withWhomBreakdown: [] } })
    expect(screen.getByText('Win rate by teammate')).toBeInTheDocument()
  })
})

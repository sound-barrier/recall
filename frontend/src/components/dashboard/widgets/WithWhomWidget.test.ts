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
    // Bar width binds to WIN RATE (the comparison axis), not share.
    // The bar communicates only through its width style — no text or
    // role to query.
    // eslint-disable-next-line testing-library/no-node-access -- style-only winrate bar has no accessible surface
    expect((rows[0]!.querySelector('.bd-fill') as HTMLElement).style.width).toBe('67%')
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

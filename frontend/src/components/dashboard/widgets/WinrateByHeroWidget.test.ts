import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import WinrateByHeroWidget from '@/components/dashboard/widgets/WinrateByHeroWidget.vue'
import WinrateByMapWidget from '@/components/dashboard/widgets/WinrateByMapWidget.vue'
import WinrateByRoleWidget from '@/components/dashboard/widgets/WinrateByRoleWidget.vue'
import { renderWidget } from '@/test-utils'

const ROWS = [
  { key: 'ana', total: 8, winrate: 75, share: 75 },
  { key: 'lucio', total: 5, winrate: 60, share: 60 },
]

describe('Win-rate-by-X widgets', () => {
  it('hero widget renders win-rate rows with the sample count and a win-rate bar', () => {
    renderWidget(WinrateByHeroWidget, { dossier: { winrateBy: ROWS } })
    expect(screen.getByText('Win-rate by hero')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('ana')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('75%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('8x')).toBeInTheDocument()
    // The bar is a meter: its value is the win-rate its width paints.
    expect(screen.getByRole('progressbar', { name: 'ana winrate' }))
      .toHaveAttribute('aria-valuenow', '75')
    expect(screen.getByRole('progressbar', { name: 'lucio winrate' }))
      .toHaveAttribute('aria-valuenow', '60')
  })

  it('map widget renders under its own eyebrow', () => {
    renderWidget(WinrateByMapWidget, { dossier: { winrateBy: ROWS } })
    expect(screen.getByText('Win-rate by map')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  it('role widget renders proper role labels — DPS, not "Dps"', () => {
    renderWidget(WinrateByRoleWidget, {
      dossier: { winrateBy: [
        { key: 'dps', total: 6, winrate: 50, share: 50 },
        { key: 'tank', total: 5, winrate: 40, share: 42 },
      ] },
    })
    expect(screen.getByText('Win-rate by role')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('DPS')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Tank')).toBeInTheDocument()
    // The bar's accessible name uses the same display label, never the raw slug.
    expect(screen.getByRole('progressbar', { name: 'DPS winrate' }))
      .toHaveAttribute('aria-valuenow', '50')
  })
})

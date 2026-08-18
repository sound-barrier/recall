import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'

import ModifierBreakdownWidget from '@/components/dashboard/widgets/ModifierBreakdownWidget.vue'
import { renderWidget } from '@/test-utils'

describe('ModifierBreakdown', () => {
  it('renders a count + win-rate row per modifier, share-bar width', () => {
    renderWidget(ModifierBreakdownWidget, {
      dossier: {
        modifierBreakdown: [
          { key: 'uphill battle', total: 6, winrate: 100, share: 40 },
          { key: 'reversal', total: 4, winrate: 0, share: 27 },
        ],
      },
    })
    expect(screen.getByText('Match modifiers')).toBeInTheDocument()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('6x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('100%')).toBeInTheDocument()
    // The bar paints share of all modifier appearances; the stat column
    // carries the win-rate.
    expect(screen.getByRole('progressbar', { name: 'uphill battle share' }))
      .toHaveAttribute('aria-valuenow', '40')
    expect(within(rows[0]!).getByText('uphill battle')).toBeInTheDocument()
  })

  it('renders nothing when the set carries no modifiers', () => {
    renderWidget(ModifierBreakdownWidget, { dossier: { modifierBreakdown: [] } })
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })
})

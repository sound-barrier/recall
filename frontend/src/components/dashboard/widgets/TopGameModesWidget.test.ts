import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import TopGameModesWidget from '@/components/dashboard/widgets/TopGameModesWidget.vue'
import { renderWidget } from '@/test-utils'

describe('TopGameModesWidget', () => {
  it('renders no rows for an empty list', () => {
    renderWidget(TopGameModesWidget, { dossier: { topByCount: [] } })
    // Height-filler placeholders are aria-hidden, so the role query
    // sees only real rows.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('renders each game mode with count + share', () => {
    renderWidget(TopGameModesWidget, {
      dossier: {
        topByCount: [
          { key: 'control', total: 8, share: 50, winrate: 75 },
          { key: 'hybrid',  total: 4, share: 25, winrate: 50 },
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]!).getByText('control')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('8x')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('50%')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'

import SessionDepthWidget from '@/components/dashboard/widgets/SessionDepthWidget.vue'
import { renderWidget } from '@/test-utils'

describe('SessionDepth', () => {
  it('renders one judged row per depth bucket, pooling the tail', () => {
    renderWidget(SessionDepthWidget, {
      dossier: {
        sessionDepth: {
          buckets: [
            { index: 1, winrate: 50, wins: 5, sample: 10 },
            { index: 2, winrate: 60, wins: 6, sample: 10 },
            { index: 3, winrate: 80, wins: 8, sample: 10 },
            { index: 4, winrate: null, wins: 0, sample: 0 },
          ],
          slope: null,
          sessions: 10,
        },
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]!).getByText('Game 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('50%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('10x')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('80%')).toBeInTheDocument()
    // Bar width — and so the meter value — is the share of games at
    // that depth, not the win rate the stat column reports. The band the
    // bar is TINTED by rides the name instead; 10 decisive is under the
    // evidence floor, so it withholds a verdict rather than inventing one.
    expect(screen.getByRole('progressbar', { name: 'Game 1 share — too few games to judge' }))
      .toHaveAttribute('aria-valuenow', '33')
    // The tail bucket pools everything at max depth and deeper.
    expect(within(rows[3]!).getByText('Game 4+')).toBeInTheDocument()
    // No sample reads as no-sample, never 0%.
    expect(within(rows[3]!).getByText('—')).toBeInTheDocument()
  })
})

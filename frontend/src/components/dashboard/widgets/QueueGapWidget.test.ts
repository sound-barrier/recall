import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import QueueGapWidget from '@/components/dashboard/widgets/QueueGapWidget.vue'
import { renderWidget } from '@/test-utils'

describe('QueueGapWidget', () => {
  it('sets the re-queue win rate against the one after a break', () => {
    renderWidget(QueueGapWidget, {
      dossier: {
        queueGapSplit: {
          tilted: { winrate: 33, sample: 9 },
          fresh: { winrate: 61, sample: 18 },
        },
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('33%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('9x')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('61%')).toBeInTheDocument()
  })

  it('names the thresholds it split on, so the reader knows what was compared', () => {
    renderWidget(QueueGapWidget, {
      dossier: {
        queueGapSplit: { tilted: { winrate: 33, sample: 9 }, fresh: { winrate: 61, sample: 18 } },
      },
    })
    expect(screen.getByText(/Re-queued within 5 min/)).toBeInTheDocument()
    expect(screen.getByText(/Back after 60\+ min away/)).toBeInTheDocument()
  })

  it('says there is nothing to compare rather than showing two empty bars', () => {
    renderWidget(QueueGapWidget, {
      dossier: {
        queueGapSplit: { tilted: { winrate: null, sample: 0 }, fresh: { winrate: null, sample: 0 } },
      },
    })
    expect(screen.getByText('Not enough back-to-back games to compare.')).toBeInTheDocument()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('shows a side with no games as no games, not as a zero rate', () => {
    renderWidget(QueueGapWidget, {
      dossier: {
        queueGapSplit: { tilted: { winrate: 40, sample: 5 }, fresh: { winrate: null, sample: 0 } },
      },
    })
    expect(screen.getByText('no games')).toBeInTheDocument()
    // …and the meter says nothing either. A screen reader hearing "0 percent"
    // on the side the page just called empty is the same lie, spoken.
    expect(screen.getByRole('progressbar', { name: /Back after 60\+ min away/ })).not.toHaveAttribute('aria-valuenow')
    expect(screen.getByRole('progressbar', { name: /Re-queued within 5 min/ })).toHaveAttribute('aria-valuenow', '40')
  })
})

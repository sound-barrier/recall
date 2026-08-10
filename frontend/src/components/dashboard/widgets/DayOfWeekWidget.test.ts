import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import DayOfWeekWidget from '@/components/dashboard/widgets/DayOfWeekWidget.vue'
import { renderWidget } from '@/test-utils'
import type { BucketEntry } from '@/composables/matches/useMatchesDossier'

function bucket(label: string, over: Partial<BucketEntry> = {}): BucketEntry {
  return { label, count: 0, share: 0, winrate: null, wins: 0, decisive: 0, ...over }
}

describe('DayOfWeekWidget', () => {
  it('renders seven rows for an empty corpus', () => {
    const buckets = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((label) => bucket(label))
    renderWidget(DayOfWeekWidget, { dossier: { dayOfWeekBuckets: buckets } })
    expect(screen.getAllByRole('listitem')).toHaveLength(7)
  })

  it('judges each day by win rate in the input rotation order', () => {
    // Caller (useMatchesDossier) is responsible for the rotation;
    // the widget renders the rows in the order it receives them.
    renderWidget(DayOfWeekWidget, {
      dossier: {
        dayOfWeekBuckets: [
          bucket('Mon', { count: 3, share: 30, winrate: 67, wins: 2, decisive: 3 }),
          bucket('Tue'),
          bucket('Wed', { count: 7, share: 70, winrate: 43, wins: 3, decisive: 7 }),
          bucket('Thu'), bucket('Fri'), bucket('Sat'), bucket('Sun'),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('Mon')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('67%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('3x')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('Wed')).toBeInTheDocument()
    // The stat column carries the judgment, not the share.
    expect(within(rows[2]!).getByText('43%')).toBeInTheDocument()
    // The bar keeps the volume footprint; the meter value matches it.
    expect(screen.getByRole('progressbar', { name: 'Wed share' }))
      .toHaveAttribute('aria-valuenow', '70')
    // A no-play day reads as no-sample.
    expect(within(rows[1]!).getByText('—')).toBeInTheDocument()
  })
})

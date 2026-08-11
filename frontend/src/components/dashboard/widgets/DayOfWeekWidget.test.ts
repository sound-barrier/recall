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
    // The bar keeps the volume footprint; the meter value matches it. At
    // 7 decisive the tint is grey for want of evidence, and the name says
    // exactly that rather than reading 43% as a slide.
    expect(screen.getByRole('progressbar', { name: 'Wed share — too few games to judge' }))
      .toHaveAttribute('aria-valuenow', '70')
    // A no-play day reads as no-sample.
    expect(within(rows[1]!).getByText('—')).toBeInTheDocument()
  })

  it('speaks the win-rate band on a day with the volume to earn one', () => {
    renderWidget(DayOfWeekWidget, {
      dossier: {
        dayOfWeekBuckets: [
          bucket('Mon', { count: 30, share: 60, winrate: 60, wins: 18, decisive: 30 }),
          bucket('Tue', { count: 20, share: 40, winrate: 40, wins: 8, decisive: 20 }),
          bucket('Wed'), bucket('Thu'), bucket('Fri'), bucket('Sat'), bucket('Sun'),
        ],
      },
    })
    expect(screen.getByRole('progressbar', { name: 'Mon share — winning' })).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Tue share — losing' })).toBeInTheDocument()
    // A day never played claims nothing at all.
    expect(screen.getByRole('progressbar', { name: 'Wed share — no matches' })).toBeInTheDocument()
  })
})

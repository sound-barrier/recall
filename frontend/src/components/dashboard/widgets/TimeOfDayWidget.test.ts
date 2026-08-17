import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import TimeOfDayWidget from '@/components/dashboard/widgets/TimeOfDayWidget.vue'
import { renderWidget } from '@/test-utils'
import type { BucketEntry } from '@/composables/matches/dossier/useMatchesDossier'

function bucket(label: string, over: Partial<BucketEntry> = {}): BucketEntry {
  return { label, count: 0, share: 0, winrate: null, wins: 0, decisive: 0, ...over }
}

describe('TimeOfDayWidget', () => {
  it('renders six no-sample rows when every bucket is empty', () => {
    const buckets = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24']
      .map((label) => bucket(label))
    renderWidget(TimeOfDayWidget, { dossier: { timeOfDayBuckets: buckets } })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(6)
    // An empty bucket reads as no-sample, not 0%.
    expect(within(rows[0]!).getByText('—')).toBeInTheDocument()
  })

  it('judges populated rows by win rate; the bar keeps the volume footprint', () => {
    renderWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          bucket('00–04'), bucket('04–08'), bucket('08–12'), bucket('12–16'),
          bucket('16–20', { count: 18, share: 60, winrate: 61, wins: 11, decisive: 18 }),
          bucket('20–24', { count: 15, share: 40, winrate: 40, wins: 6, decisive: 15 }),
        ],
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[4]!).getByText('16–20')).toBeInTheDocument()
    expect(within(rows[4]!).getByText('18x')).toBeInTheDocument()
    // The stat column carries the judgment, not the share.
    expect(within(rows[4]!).getByText('61%')).toBeInTheDocument()
    expect(within(rows[5]!).getByText('40%')).toBeInTheDocument()
    // The meter value is the volume share, matching what the width paints;
    // the NAME carries the win-rate band the tint paints, which
    // aria-valuenow (the share) cannot express.
    const winBar = screen.getByRole('progressbar', { name: '16–20 share — winning' })
    expect(winBar).toHaveAttribute('aria-valuenow', '60')
    expect(screen.getByRole('progressbar', { name: '20–24 share — losing' })).toBeInTheDocument()
  })

  it('does not let a short, loud bucket claim a verdict the tint withholds', () => {
    renderWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          // 5-0 is a 100% evening and still under the 15-decisive floor:
          // grey bar, and a name that says why rather than "winning".
          bucket('00–04', { count: 5, share: 100, winrate: 100, wins: 5, decisive: 5 }),
          bucket('04–08'), bucket('08–12'), bucket('12–16'), bucket('16–20'), bucket('20–24'),
        ],
      },
    })
    expect(screen.getByRole('progressbar', { name: '00–04 share — too few games to judge' })).toBeInTheDocument()
    expect(screen.queryByRole('progressbar', { name: /00–04 share — winning/ })).not.toBeInTheDocument()
  })

  it('a played-but-undecided bucket shows volume with a no-sample stat', () => {
    renderWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          bucket('00–04', { count: 3, share: 100, winrate: null, wins: 0, decisive: 0 }),
          bucket('04–08'), bucket('08–12'), bucket('12–16'), bucket('16–20'), bucket('20–24'),
        ],
      },
    })
    const first = screen.getAllByRole('listitem')[0]!
    expect(within(first).getByText('3x')).toBeInTheDocument()
    expect(within(first).getByText('—')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import DayOfWeekWidget from '@/components/dashboard/widgets/DayOfWeekWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'
import type { BucketEntry } from '@/composables/matches/useMatchesDossier'

function bucket(label: string, over: Partial<BucketEntry> = {}): BucketEntry {
  return { label, count: 0, share: 0, winrate: null, wins: 0, decisive: 0, ...over }
}

describe('DayOfWeekWidget', () => {
  it('renders seven rows for an empty corpus', () => {
    const buckets = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((label) => bucket(label))
    const w = mountWidget(DayOfWeekWidget, { dossier: { dayOfWeekBuckets: buckets } })
    expect(w.findAll('li')).toHaveLength(7)
  })

  it('judges each day by win rate in the input rotation order', () => {
    // Caller (useMatchesDossier) is responsible for the rotation;
    // the widget renders the rows in the order it receives them.
    const w = mountWidget(DayOfWeekWidget, {
      dossier: {
        dayOfWeekBuckets: [
          bucket('Mon', { count: 3, share: 30, winrate: 67, wins: 2, decisive: 3 }),
          bucket('Tue'),
          bucket('Wed', { count: 7, share: 70, winrate: 43, wins: 3, decisive: 7 }),
          bucket('Thu'), bucket('Fri'), bucket('Sat'), bucket('Sun'),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows[0]!.find('.bd-name').text()).toBe('Mon')
    expect(rows[0]!.find('.bd-stats').text()).toBe('67%')
    expect(rows[0]!.find('.bd-time').text()).toBe('3x')
    expect(rows[2]!.find('.bd-name').text()).toBe('Wed')
    // The stat column carries the judgment, not the share.
    expect(rows[2]!.find('.bd-stats').text()).toBe('43%')
    // The bar keeps the volume footprint.
    expect(rows[2]!.find('.bd-fill').attributes('style')).toContain('width: 70%')
    // A no-play day reads as no-sample.
    expect(rows[1]!.find('.bd-stats').text()).toBe('—')
  })
})

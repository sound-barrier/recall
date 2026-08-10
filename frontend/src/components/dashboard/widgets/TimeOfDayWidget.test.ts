import { describe, it, expect } from 'vitest'
import TimeOfDayWidget from '@/components/dashboard/widgets/TimeOfDayWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'
import type { BucketEntry } from '@/composables/matches/useMatchesDossier'

function bucket(label: string, over: Partial<BucketEntry> = {}): BucketEntry {
  return { label, count: 0, share: 0, winrate: null, wins: 0, decisive: 0, ...over }
}

describe('TimeOfDayWidget', () => {
  it('renders six no-sample rows when every bucket is empty', () => {
    const buckets = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24']
      .map((label) => bucket(label))
    const w = mountWidget(TimeOfDayWidget, { dossier: { timeOfDayBuckets: buckets } })
    expect(w.findAll('li')).toHaveLength(6)
    // An empty bucket reads as no-sample, not 0%.
    expect(w.findAll('.bd-stats').at(0)!.text()).toBe('—')
  })

  it('judges populated rows by win rate; the bar keeps the volume footprint', () => {
    const w = mountWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          bucket('00–04'), bucket('04–08'), bucket('08–12'), bucket('12–16'),
          bucket('16–20', { count: 18, share: 60, winrate: 61, wins: 11, decisive: 18 }),
          bucket('20–24', { count: 15, share: 40, winrate: 40, wins: 6, decisive: 15 }),
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows[4]!.find('.bd-name').text()).toBe('16–20')
    expect(rows[4]!.find('.bd-time').text()).toBe('18x')
    // The stat column carries the judgment, not the share.
    expect(rows[4]!.find('.bd-stats').text()).toBe('61%')
    expect(rows[5]!.find('.bd-stats').text()).toBe('40%')
    // Width stays the volume share; color comes from the shared
    // judgment engine (18 decisive at 61% clears the evidence floor).
    expect(rows[4]!.find('.bd-fill').attributes('style')).toContain('width: 60%')
    expect(rows[4]!.find('.bd-fill').classes()).toContain('cell-win')
    expect(rows[5]!.find('.bd-fill').classes()).toContain('cell-loss')
  })

  it('a played-but-undecided bucket shows volume with a no-sample stat', () => {
    const w = mountWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          bucket('00–04', { count: 3, share: 100, winrate: null, wins: 0, decisive: 0 }),
          bucket('04–08'), bucket('08–12'), bucket('12–16'), bucket('16–20'), bucket('20–24'),
        ],
      },
    })
    const first = w.findAll('li')[0]!
    expect(first.find('.bd-time').text()).toBe('3x')
    expect(first.find('.bd-stats').text()).toBe('—')
  })
})

import { describe, it, expect } from 'vitest'
import TimeOfDayWidget from './TimeOfDayWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

describe('TimeOfDayWidget', () => {
  it('renders six rows even when every bucket is empty', () => {
    const buckets = ['00–04', '04–08', '08–12', '12–16', '16–20', '20–24']
      .map((label) => ({ label, count: 0, share: 0 }))
    const w = mountWidget(TimeOfDayWidget, { dossier: { timeOfDayBuckets: buckets } })
    expect(w.findAll('li')).toHaveLength(6)
    expect(w.findAll('.bd-stats').at(0)!.text()).toBe('0%')
  })

  it('renders the bucket label, count, and share for populated rows', () => {
    const w = mountWidget(TimeOfDayWidget, {
      dossier: {
        timeOfDayBuckets: [
          { label: '00–04', count: 0,  share: 0 },
          { label: '04–08', count: 0,  share: 0 },
          { label: '08–12', count: 0,  share: 0 },
          { label: '12–16', count: 0,  share: 0 },
          { label: '16–20', count: 6,  share: 60 },
          { label: '20–24', count: 4,  share: 40 },
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows[4]!.find('.bd-name').text()).toBe('16–20')
    expect(rows[4]!.find('.bd-time').text()).toBe('6x')
    expect(rows[4]!.find('.bd-stats').text()).toBe('60%')
  })
})

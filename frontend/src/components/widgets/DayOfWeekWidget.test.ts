import { describe, it, expect } from 'vitest'
import DayOfWeekWidget from './DayOfWeekWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

describe('DayOfWeekWidget', () => {
  it('renders seven rows for an empty corpus', () => {
    const buckets = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
      .map((label) => ({ label, count: 0, share: 0 }))
    const w = mountWidget(DayOfWeekWidget, { dossier: { dayOfWeekBuckets: buckets } })
    expect(w.findAll('li')).toHaveLength(7)
  })

  it('renders the day label, count and share with the input rotation order', () => {
    // Caller (useMatchesDossier) is responsible for the rotation;
    // the widget renders the rows in the order it receives them.
    const w = mountWidget(DayOfWeekWidget, {
      dossier: {
        dayOfWeekBuckets: [
          { label: 'Mon', count: 3, share: 30 },
          { label: 'Tue', count: 0, share: 0 },
          { label: 'Wed', count: 7, share: 70 },
          { label: 'Thu', count: 0, share: 0 },
          { label: 'Fri', count: 0, share: 0 },
          { label: 'Sat', count: 0, share: 0 },
          { label: 'Sun', count: 0, share: 0 },
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows[0]!.find('.bd-name').text()).toBe('Mon')
    expect(rows[2]!.find('.bd-name').text()).toBe('Wed')
    expect(rows[2]!.find('.bd-stats').text()).toBe('70%')
  })
})

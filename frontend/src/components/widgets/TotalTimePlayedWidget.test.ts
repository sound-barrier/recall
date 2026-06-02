import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import TotalTimePlayedWidget from './TotalTimePlayedWidget.vue'

const ttp = (minutes: number, label: string, recordsWithTime: number, recordsTotal: number) => ({
  minutes,
  label,
  recordsWithTime,
  recordsTotal,
})

describe('TotalTimePlayedWidget', () => {
  it('renders the label', () => {
    const w = mount(TotalTimePlayedWidget, {
      props: { totalTimePlayed: ttp(452, '7h32min', 14, 14) },
    })
    expect(w.find('.kpi-value').text()).toBe('7h32min')
  })

  it('shows coverage subtitle when records lack game_length', () => {
    const w = mount(TotalTimePlayedWidget, {
      props: { totalTimePlayed: ttp(40, '40min', 2, 4) },
    })
    expect(w.find('.kpi-sub').text()).toBe('2 of 4 matches')
  })

  it('hides coverage subtitle when every record contributed time', () => {
    const w = mount(TotalTimePlayedWidget, {
      props: { totalTimePlayed: ttp(80, '1h20min', 4, 4) },
    })
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('hides coverage subtitle when NO record contributed (renders just the label)', () => {
    const w = mount(TotalTimePlayedWidget, {
      props: { totalTimePlayed: ttp(0, '—', 0, 4) },
    })
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

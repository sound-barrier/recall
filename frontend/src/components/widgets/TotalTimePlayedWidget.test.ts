import { describe, it, expect } from 'vitest'
import TotalTimePlayedWidget from './TotalTimePlayedWidget.vue'
import { mountWidget } from '../../test-utils/mountWidget'

const ttp = (minutes: number, label: string, recordsWithTime: number, recordsTotal: number) => ({
  minutes,
  label,
  recordsWithTime,
  recordsTotal,
})

describe('TotalTimePlayedWidget', () => {
  it('renders the formatPlayMinutes label by default (hh:mm unit)', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(452, '7h32min', 14, 14) },
    })
    expect(w.find('.kpi-value').text()).toBe('7h32min')
  })

  it('renders the rounded-hours form when unit=h', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier:    { totalTimePlayed: ttp(452, '7h32min', 14, 14) },
      configSeed: { 'total-time': { unit: 'h' } },
    })
    // 452 / 60 ≈ 7.53 → rounds to 8h.
    expect(w.find('.kpi-value').text()).toBe('8h')
  })

  it('renders the days + hours form when unit=d-h', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      // 50 hours = 2d 2h.
      dossier:    { totalTimePlayed: ttp(3000, '50h', 14, 14) },
      configSeed: { 'total-time': { unit: 'd-h' } },
    })
    expect(w.find('.kpi-value').text()).toBe('2d 2h')
  })

  it('falls back to rem-only h when sub-day in d-h mode', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier:    { totalTimePlayed: ttp(120, '2h', 4, 4) },
      configSeed: { 'total-time': { unit: 'd-h' } },
    })
    expect(w.find('.kpi-value').text()).toBe('2h')
  })

  it('shows coverage subtitle when records lack game_length', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(40, '40min', 2, 4) },
    })
    expect(w.find('.kpi-sub').text()).toBe('2 of 4 matches')
  })

  it('hides coverage subtitle when every record contributed time', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(80, '1h20min', 4, 4) },
    })
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })

  it('renders em-dash when NO record contributed', () => {
    const w = mountWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(0, '—', 0, 4) },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

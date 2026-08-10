import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import TotalTimePlayedWidget from '@/components/dashboard/widgets/TotalTimePlayedWidget.vue'
import { renderWidget } from '@/test-utils'

const ttp = (minutes: number, label: string, recordsWithTime: number, recordsTotal: number) => ({
  minutes,
  label,
  recordsWithTime,
  recordsTotal,
})

describe('TotalTimePlayedWidget', () => {
  it('renders the formatPlayMinutes label by default (hh:mm unit)', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(452, '7h32min', 14, 14) },
    })
    expect(screen.getByText('7h32min')).toBeInTheDocument()
  })

  it('renders the rounded-hours form when unit=h', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier:    { totalTimePlayed: ttp(452, '7h32min', 14, 14) },
      configSeed: { 'total-time': { unit: 'h' } },
    })
    // 452 / 60 ≈ 7.53 → rounds to 8h.
    expect(screen.getByText('8h')).toBeInTheDocument()
  })

  it('renders the days + hours form when unit=d-h', () => {
    renderWidget(TotalTimePlayedWidget, {
      // 50 hours = 2d 2h.
      dossier:    { totalTimePlayed: ttp(3000, '50h', 14, 14) },
      configSeed: { 'total-time': { unit: 'd-h' } },
    })
    expect(screen.getByText('2d 2h')).toBeInTheDocument()
  })

  it('falls back to rem-only h when sub-day in d-h mode', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier:    { totalTimePlayed: ttp(120, '2h', 4, 4) },
      configSeed: { 'total-time': { unit: 'd-h' } },
    })
    expect(screen.getByText('2h')).toBeInTheDocument()
  })

  it('shows coverage subtitle when records lack game_length', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(40, '40min', 2, 4) },
    })
    expect(screen.getByText('2 of 4 matches')).toBeInTheDocument()
  })

  it('hides coverage subtitle when every record contributed time', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(80, '1h20min', 4, 4) },
    })
    expect(screen.queryByText(/of \d+ matches/)).not.toBeInTheDocument()
  })

  it('renders em-dash when NO record contributed', () => {
    renderWidget(TotalTimePlayedWidget, {
      dossier: { totalTimePlayed: ttp(0, '—', 0, 4) },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/of \d+ matches/)).not.toBeInTheDocument()
  })
})

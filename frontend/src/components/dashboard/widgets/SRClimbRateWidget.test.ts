import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import SRClimbRateWidget from '@/components/dashboard/widgets/SRClimbRateWidget.vue'
import { renderWidget } from '@/test-utils'

describe('SRClimbRateWidget', () => {
  it('reports the weekly rate in SR, signed', () => {
    renderWidget(SRClimbRateWidget, {
      dossier: { srClimbRate: { perWeek: 42, perSession: 14, sessions: 3, readCount: 9 } },
    })
    expect(screen.getByText('+42 SR/wk')).toBeInTheDocument()
    expect(screen.getByText('+14/session · 9 readings')).toBeInTheDocument()
  })

  it('says nothing was read rather than printing a zero climb', () => {
    // SR is reported far less often than the meter, so this is the COMMON
    // case, not an edge one — printing 0 would read as a stalled climb.
    renderWidget(SRClimbRateWidget, {
      dossier: { srClimbRate: { perWeek: null, perSession: null, sessions: 0, readCount: 0 } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No SR readings in this window.')).toBeInTheDocument()
  })

  it('carries the direction as a word, not only as a tint', () => {
    renderWidget(SRClimbRateWidget, {
      dossier: { srClimbRate: { perWeek: -30, perSession: -10, sessions: 3, readCount: 6 } },
    })
    expect(screen.getByRole('img', { name: '-30 SR/wk — losing' })).toBeInTheDocument()
  })

  it('claims no alternative text when there is no direction to speak', () => {
    renderWidget(SRClimbRateWidget, {
      dossier: { srClimbRate: { perWeek: null, perSession: null, sessions: 0, readCount: 0 } },
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })
})

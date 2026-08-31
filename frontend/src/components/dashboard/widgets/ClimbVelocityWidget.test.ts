import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import ClimbVelocityWidget from '@/components/dashboard/widgets/ClimbVelocityWidget.vue'
import { renderWidget } from '@/test-utils'

describe('ClimbVelocityWidget', () => {
  it('reports the weekly rate, signed, with the per-session rate and sample beside it', () => {
    renderWidget(ClimbVelocityWidget, {
      dossier: { velocity: { perSession: 4, perWeek: 12, sessions: 3, readCount: 9 } },
    })
    expect(screen.getByText('+12%/wk')).toBeInTheDocument()
    expect(screen.getByText('+4%/session · 9 readings')).toBeInTheDocument()
  })

  it('says nothing was read rather than printing a zero rate', () => {
    // An unknown rate is not a stalled climb. Zero here would be a lie the
    // player would read as "I am going nowhere".
    renderWidget(ClimbVelocityWidget, {
      dossier: { velocity: { perSession: null, perWeek: null, sessions: 0, readCount: 0 } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('No rank movement was read in this window.')).toBeInTheDocument()
  })

  it('carries the direction as a word, not only as a tint', () => {
    // WCAG 1.4.1 — the tint is the only visual cue separating a climb from a
    // slide, so the band word has to ride in the accessible name.
    renderWidget(ClimbVelocityWidget, {
      dossier: { velocity: { perSession: -3, perWeek: -8, sessions: 2, readCount: 5 } },
    })
    expect(screen.getByRole('img', { name: '-8%/wk — losing' })).toBeInTheDocument()
  })

  it('does not claim to be an image when it has no alternative text', () => {
    // role="img" without an accessible name is a WCAG 1.1.1 failure. The dash
    // is not a picture of anything — the detail line carries the meaning.
    renderWidget(ClimbVelocityWidget, {
      dossier: { velocity: { perSession: null, perWeek: null, sessions: 0, readCount: 0 } },
    })
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('drops the per-session clause when only the weekly rate is known', () => {
    renderWidget(ClimbVelocityWidget, {
      dossier: { velocity: { perSession: null, perWeek: 6, sessions: 0, readCount: 4 } },
    })
    expect(screen.getByText('4 readings')).toBeInTheDocument()
  })
})

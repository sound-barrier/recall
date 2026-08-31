import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import RollingBaselineWidget from '@/components/dashboard/widgets/RollingBaselineWidget.vue'
import { renderWidget } from '@/test-utils'

describe('RollingBaselineWidget', () => {
  it('sets this window against the trailing baseline as a standardized difference', () => {
    renderWidget(RollingBaselineWidget, {
      dossier: {
        rollingBaseline: {
          recentRate: 0.64, baselineRate: 0.5, sigma: 1.4, pValue: 0.16, recentN: 14, baselineN: 60,
        },
      },
    })
    expect(screen.getByText('64%')).toBeInTheDocument()
    expect(screen.getByText('↑ +1.4σ')).toBeInTheDocument()
    expect(screen.getByText(/vs 50% baseline · n=14/)).toBeInTheDocument()
  })

  it('marks a below-baseline window with the falling arrow', () => {
    renderWidget(RollingBaselineWidget, {
      dossier: {
        rollingBaseline: {
          recentRate: 0.35, baselineRate: 0.52, sigma: -2.1, pValue: 0.03, recentN: 20, baselineN: 80,
        },
      },
    })
    expect(screen.getByText('↓ -2.1σ')).toBeInTheDocument()
  })

  it('carries the direction as a word, since the tint is the only other cue', () => {
    renderWidget(RollingBaselineWidget, {
      dossier: {
        rollingBaseline: {
          recentRate: 0.35, baselineRate: 0.52, sigma: -2.1, pValue: 0.03, recentN: 20, baselineN: 80,
        },
      },
    })
    expect(screen.getByRole('img', { name: '↓ -2.1σ — losing' })).toBeInTheDocument()
  })

  it('refuses the sigma below the sample floor and names both counts', () => {
    // A raw gap lies about small samples: three matches swinging twenty points
    // and forty moving six read identically.
    renderWidget(RollingBaselineWidget, {
      dossier: {
        rollingBaseline: {
          recentRate: 0.66, baselineRate: null, sigma: null, pValue: null, recentN: 3, baselineN: 1,
        },
      },
    })
    expect(screen.getByText('Not enough games to compare — 3 recent vs 1 before.')).toBeInTheDocument()
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
  })

  it('prints a dash, not a zero, when the window itself is empty', () => {
    renderWidget(RollingBaselineWidget, {
      dossier: {
        rollingBaseline: {
          recentRate: null, baselineRate: null, sigma: null, pValue: null, recentN: 0, baselineN: 0,
        },
      },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
  })
})

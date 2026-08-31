import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'
import PerfVsRankWidget from '@/components/dashboard/widgets/PerfVsRankWidget.vue'
import { renderWidget } from '@/test-utils'

const delta = (over: Partial<{ sigma: number | null; recentN: number; baselineN: number }> = {}) => ({
  recentRate: 0.6, baselineRate: 0.5, pValue: 0.1,
  sigma: 1.4, recentN: 12, baselineN: 40, ...over,
})

describe('PerfVsRankWidget', () => {
  it('names the deflation the player suspects, in words rather than a sigma', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: { perfVsRank: { delta: delta(), netPercent: 0, readCount: 10, readOf: 12, verdict: 'deflation' } },
    })
    expect(screen.getByText('Playing above your baseline, rank flat')).toBeInTheDocument()
    expect(screen.getByText('+1.4σ vs your 30-day baseline, rank 0% across 10 readings.')).toBeInTheDocument()
  })

  it('reports the flattering case too', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: {
        perfVsRank: { delta: delta({ sigma: -1.6 }), netPercent: 15, readCount: 8, readOf: 9, verdict: 'lucky' },
      },
    })
    expect(screen.getByText('Rank climbed on a below-baseline week')).toBeInTheDocument()
    expect(screen.getByText('-1.6σ vs your 30-day baseline, rank +15% across 8 readings.')).toBeInTheDocument()
  })

  it('says the play and the rank agree', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: { perfVsRank: { delta: delta({ sigma: 0.2 }), netPercent: 4, readCount: 6, readOf: 6, verdict: 'matched' } },
    })
    expect(screen.getByText('Rank is following the play')).toBeInTheDocument()
  })

  it('blames the sample, not the player, when either side is too thin', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: {
        perfVsRank: {
          delta: delta({ sigma: null, recentN: 3, baselineN: 2 }),
          netPercent: null, readCount: 0, readOf: 3, verdict: 'unknown',
        },
      },
    })
    expect(screen.getByText('Not enough to say')).toBeInTheDocument()
    expect(screen.getByText('Needs more games either side — 3 recent, 2 before.')).toBeInTheDocument()
  })

  it('distinguishes "no pill was read" from "the rank did not move"', () => {
    // Reading an unread movement pill as a flat rank is exactly how this
    // widget would invent a deflation that never happened.
    renderWidget(PerfVsRankWidget, {
      dossier: {
        perfVsRank: { delta: delta(), netPercent: null, readCount: 0, readOf: 14, verdict: 'unknown' },
      },
    })
    expect(screen.getByText(
      'No rank movement was read in the window, so there is nothing to compare the play against.',
    )).toBeInTheDocument()
  })

  it('names the coverage when some pills were read but too few to judge by', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: {
        perfVsRank: { delta: delta(), netPercent: null, readCount: 4, readOf: 19, verdict: 'unknown' },
      },
    })
    expect(screen.getByText(
      'Only 4 of 19 matches reported a rank movement — too thin to judge the week by.',
    )).toBeInTheDocument()
  })

  it('speaks the verdict as the accessible name, since the tint alone is not one', () => {
    renderWidget(PerfVsRankWidget, {
      dossier: { perfVsRank: { delta: delta(), netPercent: 0, readCount: 10, readOf: 12, verdict: 'deflation' } },
    })
    expect(screen.getByRole('img', { name: 'Playing above your baseline, rank flat' })).toBeInTheDocument()
  })
})

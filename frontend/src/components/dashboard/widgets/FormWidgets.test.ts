import { describe, it, expect } from 'vitest'
import { screen, within } from '@testing-library/vue'
import { renderWidget } from '@/test-utils'
import FormDeltaWidget from '@/components/dashboard/widgets/FormDeltaWidget.vue'
import LossStreakRecoveryWidget from '@/components/dashboard/widgets/LossStreakRecoveryWidget.vue'
import SessionDepthWidget from '@/components/dashboard/widgets/SessionDepthWidget.vue'

describe('FormDeltaWidget', () => {
  it('shows the recent rate with the signed gap vs overall', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 65, sample: 20 },
          overall:  { winrate: 63, sample: 30 },
          deltaPts: 2,
        },
      },
    })
    expect(screen.getByText('65%')).toBeInTheDocument()
    expect(screen.getByText('+2 pts')).toHaveClass('gap-up')
    expect(screen.getByText(/vs 63% overall/)).toHaveTextContent('n=20')
  })

  it('colors a negative gap as a down-trend', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 40, sample: 20 },
          overall:  { winrate: 55, sample: 60 },
          deltaPts: -15,
        },
      },
    })
    expect(screen.getByText('-15 pts')).toHaveClass('gap-down')
  })

  it('renders an em-dash and no sub on an empty corpus', () => {
    renderWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: null, sample: 0 },
          overall:  { winrate: null, sample: 0 },
          deltaPts: null,
        },
      },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/pts/)).not.toBeInTheDocument()
  })
})

describe('LossStreakRecoveryWidget', () => {
  it('shows the recovery rate over its sample with the overall baseline', () => {
    renderWidget(LossStreakRecoveryWidget, {
      dossier: {
        lossStreakRecovery: { winrate: 83, sample: 6 },
        winrate: 63,
      },
    })
    expect(screen.getByText('After 2+ losses')).toBeInTheDocument()
    expect(screen.getByText('83%')).toBeInTheDocument()
    expect(screen.getByText(/vs 63% overall/)).toHaveTextContent('n=6')
  })

  it('reflects a configured streak floor in the eyebrow', () => {
    renderWidget(LossStreakRecoveryWidget, {
      dossier: { lossStreakRecovery: { winrate: 50, sample: 2 } },
      configSeed: { 'loss-streak-recovery': { minStreak: 3 } },
    })
    expect(screen.getByText('After 3+ losses')).toBeInTheDocument()
  })

  it('renders an em-dash and no sub when no streak ever qualified', () => {
    renderWidget(LossStreakRecoveryWidget, {
      dossier: { lossStreakRecovery: { winrate: null, sample: 0 } },
    })
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.queryByText(/n=/)).not.toBeInTheDocument()
  })
})

describe('SessionDepthWidget', () => {
  it('renders one judged row per depth bucket, pooling the tail', () => {
    renderWidget(SessionDepthWidget, {
      dossier: {
        sessionDepth: {
          buckets: [
            { index: 1, winrate: 50, wins: 5, sample: 10 },
            { index: 2, winrate: 60, wins: 6, sample: 10 },
            { index: 3, winrate: 80, wins: 8, sample: 10 },
            { index: 4, winrate: null, wins: 0, sample: 0 },
          ],
          slope: null,
          sessions: 10,
        },
      },
    })
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(4)
    expect(within(rows[0]!).getByText('Game 1')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('50%')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('10x')).toBeInTheDocument()
    expect(within(rows[2]!).getByText('80%')).toBeInTheDocument()
    // The tail bucket pools everything at max depth and deeper.
    expect(within(rows[3]!).getByText('Game 4+')).toBeInTheDocument()
    // No sample reads as no-sample, never 0%.
    expect(within(rows[3]!).getByText('—')).toBeInTheDocument()
  })
})

import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/vue'

import LossStreakRecoveryWidget from '@/components/dashboard/widgets/LossStreakRecoveryWidget.vue'
import { renderWidget } from '@/test-utils'

describe('LossStreakRecovery', () => {
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

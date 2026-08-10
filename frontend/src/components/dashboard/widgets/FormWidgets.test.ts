import { describe, it, expect } from 'vitest'
import { mountWidget } from '@/test-utils/mountWidget'
import FormDeltaWidget from '@/components/dashboard/widgets/FormDeltaWidget.vue'
import LossStreakRecoveryWidget from '@/components/dashboard/widgets/LossStreakRecoveryWidget.vue'
import SessionDepthWidget from '@/components/dashboard/widgets/SessionDepthWidget.vue'

describe('FormDeltaWidget', () => {
  it('shows the recent rate with the signed gap vs overall', () => {
    const w = mountWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 65, sample: 20 },
          overall:  { winrate: 63, sample: 30 },
          deltaPts: 2,
        },
      },
    })
    expect(w.find('.kpi-value').text()).toBe('65%')
    expect(w.find('.kpi-sub').text()).toContain('+2 pts')
    expect(w.find('.kpi-sub').text()).toContain('vs 63% overall')
    expect(w.find('.kpi-sub').text()).toContain('n=20')
    expect(w.find('.form-gap').classes()).toContain('gap-up')
  })

  it('colors a negative gap as a down-trend', () => {
    const w = mountWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: 40, sample: 20 },
          overall:  { winrate: 55, sample: 60 },
          deltaPts: -15,
        },
      },
    })
    expect(w.find('.kpi-sub').text()).toContain('-15 pts')
    expect(w.find('.form-gap').classes()).toContain('gap-down')
  })

  it('renders an em-dash and no sub on an empty corpus', () => {
    const w = mountWidget(FormDeltaWidget, {
      dossier: {
        formDelta: {
          recent:   { winrate: null, sample: 0 },
          overall:  { winrate: null, sample: 0 },
          deltaPts: null,
        },
      },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

describe('LossStreakRecoveryWidget', () => {
  it('shows the recovery rate over its sample with the overall baseline', () => {
    const w = mountWidget(LossStreakRecoveryWidget, {
      dossier: {
        lossStreakRecovery: { winrate: 83, sample: 6 },
        winrate: 63,
      },
    })
    expect(w.find('.kpi-eyebrow').text()).toBe('After 2+ losses')
    expect(w.find('.kpi-value').text()).toBe('83%')
    expect(w.find('.kpi-sub').text()).toContain('n=6')
    expect(w.find('.kpi-sub').text()).toContain('vs 63% overall')
  })

  it('reflects a configured streak floor in the eyebrow', () => {
    const w = mountWidget(LossStreakRecoveryWidget, {
      dossier: { lossStreakRecovery: { winrate: 50, sample: 2 } },
      configSeed: { 'loss-streak-recovery': { minStreak: 3 } },
    })
    expect(w.find('.kpi-eyebrow').text()).toBe('After 3+ losses')
  })

  it('renders an em-dash and no sub when no streak ever qualified', () => {
    const w = mountWidget(LossStreakRecoveryWidget, {
      dossier: { lossStreakRecovery: { winrate: null, sample: 0 } },
    })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').exists()).toBe(false)
  })
})

describe('SessionDepthWidget', () => {
  it('renders one judged row per depth bucket, pooling the tail', () => {
    const w = mountWidget(SessionDepthWidget, {
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
    const rows = w.findAll('li')
    expect(rows).toHaveLength(4)
    expect(rows[0]!.find('.bd-name').text()).toBe('Game 1')
    expect(rows[0]!.find('.bd-stats').text()).toBe('50%')
    expect(rows[0]!.find('.bd-time').text()).toBe('10x')
    expect(rows[2]!.find('.bd-stats').text()).toBe('80%')
    // The tail bucket pools everything at max depth and deeper.
    expect(rows[3]!.find('.bd-name').text()).toBe('Game 4+')
    // No sample reads as no-sample, never 0%.
    expect(rows[3]!.find('.bd-stats').text()).toBe('—')
  })
})

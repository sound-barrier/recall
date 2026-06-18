import { describe, it, expect } from 'vitest'
import CurrentRankWidget from '@/components/dashboard/widgets/CurrentRankWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

describe('CurrentRankWidget', () => {
  it('renders the latest rank per role', () => {
    const w = mountWidget(CurrentRankWidget, {
      dossier: {
        currentRank: [
          { key: 'tank', label: 'Tank', tier: 'platinum', level: 1, progress: 60 },
          { key: 'dps', label: 'DPS', tier: 'gold', level: 3, progress: 20 },
        ],
      },
    })
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('Tank')
    expect(rows[0]!.text()).toContain('platinum 1')
    expect(rows[0]!.text()).toContain('60%')
    // The bar fill clamps the within-division progress to width %.
    expect(rows[0]!.find('.bd-fill').attributes('style')).toContain('60%')
  })

  it('clamps a negative (demotion) progress to a non-negative bar width', () => {
    const w = mountWidget(CurrentRankWidget, {
      dossier: { currentRank: [{ key: 'tank', label: 'Tank', tier: 'gold', level: 1, progress: -19 }] },
    })
    expect(w.find('.bd-fill').attributes('style')).toContain('0%')
    expect(w.find('.bd-stats').text()).toContain('-19%')
  })

  it('shows an empty state when there are no rank readings', () => {
    const w = mountWidget(CurrentRankWidget, { dossier: { currentRank: [] } })
    expect(w.find('.cr-empty').exists()).toBe(true)
    expect(w.findAll('li')).toHaveLength(0)
  })
})

import { describe, it, expect } from 'vitest'

import HeroesPerMatchWidget from '@/components/dashboard/widgets/HeroesPerMatchWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const BUCKETS = [
  { key: '1 hero', heroes: 1, total: 13, wins: 9, decisive: 13, winrate: 69, lowSample: false },
  { key: '2 heroes', heroes: 2, total: 4, wins: 1, decisive: 4, winrate: 25, lowSample: true },
]

describe('HeroesPerMatchWidget', () => {
  it('renders one row per bucket with count, winrate bar, and low-sample tag', () => {
    const w = mountWidget(HeroesPerMatchWidget, { dossier: { heroCountBuckets: BUCKETS } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Heroes per match')
    const rows = w.findAll('li')
    expect(rows).toHaveLength(2)
    expect(rows[0]!.text()).toContain('1 hero')
    expect(rows[0]!.text()).toContain('13x')
    expect(rows[0]!.text()).toContain('69%')
    expect(rows[0]!.find('.bd-fill').attributes('style')).toContain('69%')
    expect(rows[0]!.find('[data-low-sample]').exists()).toBe(false)
    expect(rows[1]!.find('[data-low-sample]').exists()).toBe(true)
  })

  it('shows a placeholder when no bucket exists', () => {
    const w = mountWidget(HeroesPerMatchWidget, { dossier: { heroCountBuckets: [] } })
    expect(w.find('.breakdown-empty').text()).toContain('No matches')
  })
})

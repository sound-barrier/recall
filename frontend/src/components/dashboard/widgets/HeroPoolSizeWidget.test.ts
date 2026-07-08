import { describe, it, expect } from 'vitest'
import HeroPoolSizeWidget from '@/components/dashboard/widgets/HeroPoolSizeWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const EMPTY_SPLIT = { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } }

function pool(keys: string[]) {
  return {
    pool: keys.map((key, i) => ({ key, total: 10 - i, wins: 5, losses: 4, winrate: 55, lowSample: false })),
    split: EMPTY_SPLIT,
    outHeroes: [],
  }
}

describe('HeroPoolSizeWidget', () => {
  it('renders an em-dash and an invitation when no pool derives', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool([]) } })
    expect(w.find('.kpi-value').text()).toBe('—')
    expect(w.find('.kpi-sub').text()).toContain('no pool yet')
  })

  it('shows the derived pool size with the member roster as the subtitle', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool(['lucio', 'brig']) } })
    expect(w.find('.kpi-value').text()).toBe('2')
    expect(w.find('.kpi-sub').text()).toBe('lucio, brig')
  })

  it('truncates a large roster to three names plus a count', () => {
    const w = mountWidget(HeroPoolSizeWidget, { dossier: { heroPool: pool(['a', 'b', 'c', 'd', 'e']) } })
    expect(w.find('.kpi-value').text()).toBe('5')
    expect(w.find('.kpi-sub').text()).toBe('a, b, c +2')
    expect(w.find('.kpi-sub').attributes('title')).toBe('a, b, c, d, e')
  })
})

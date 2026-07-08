import { describe, it, expect } from 'vitest'

import HeroPoolWidget from '@/components/dashboard/widgets/HeroPoolWidget.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const ANALYSIS = {
  pool: [
    { key: 'lucio', total: 12, wins: 7, losses: 5, winrate: 58, lowSample: false },
    { key: 'brig', total: 5, wins: 3, losses: 2, winrate: 60, lowSample: false },
  ],
  split: {
    pure: { games: 13, wins: 9, decisive: 13, winrate: 69 },
    out: { games: 4, wins: 1, decisive: 4, winrate: 25 },
  },
  outHeroes: [
    { key: 'ana', total: 3, wins: 1, losses: 2, winrate: 33, lowSample: true },
  ],
}

describe('HeroPoolWidget', () => {
  it('renders the pool, the in/out split, and the out-of-pool records', () => {
    const w = mountWidget(HeroPoolWidget, { dossier: { heroPool: ANALYSIS } })
    expect(w.find('.breakdown-eyebrow').text()).toBe('Hero pool')

    const pool = w.findAll('[data-pool-hero]')
    expect(pool).toHaveLength(2)
    expect(pool[0]!.text()).toContain('lucio')
    expect(pool[0]!.text()).toContain('12x')

    expect(w.find('[data-pool-split="pure"]').text()).toContain('In pool')
    expect(w.find('[data-pool-split="pure"]').text()).toContain('69%')
    expect(w.find('[data-pool-split="out"]').text()).toContain('25%')

    const out = w.findAll('[data-pool-out-hero]')
    expect(out).toHaveLength(1)
    expect(out[0]!.text()).toContain('ana')
    expect(out[0]!.text()).toContain('1W–2L')
    expect(out[0]!.find('[data-low-sample]').exists()).toBe(true)
  })

  it('invites play when no pool derives yet', () => {
    const w = mountWidget(HeroPoolWidget, {
      dossier: { heroPool: { pool: [], split: { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } }, outHeroes: [] } },
    })
    expect(w.find('.breakdown-empty').text()).toContain('joins your pool')
    expect(w.findAll('[data-pool-hero]')).toHaveLength(0)
  })
})

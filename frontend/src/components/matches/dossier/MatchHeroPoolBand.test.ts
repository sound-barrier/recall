import { describe, it, expect } from 'vitest'

import MatchHeroPoolBand from '@/components/matches/dossier/MatchHeroPoolBand.vue'
import { mountWidget } from '@/test-utils/mountWidget'

const ANALYSIS = {
  pool: [
    { key: 'lucio', role: 'support', total: 12, wins: 7, losses: 5, winrate: 58, lowSample: false },
    { key: 'brig', role: 'support', total: 5, wins: 3, losses: 2, winrate: 60, lowSample: false },
  ],
  split: {
    pure: { games: 13, wins: 9, decisive: 13, winrate: 69 },
    out: { games: 4, wins: 1, decisive: 4, winrate: 25 },
  },
  outHeroes: [
    { key: 'ana', role: 'support', total: 3, wins: 1, losses: 2, winrate: 33, lowSample: true },
  ],
}

const EMPTY = {
  pool: [],
  split: { pure: { games: 0, wins: 0, decisive: 0, winrate: 0 }, out: { games: 0, wins: 0, decisive: 0, winrate: 0 } },
  outHeroes: [],
}

describe('MatchHeroPoolBand', () => {
  it('renders pool, discipline split, and out-of-pool columns', () => {
    const w = mountWidget(MatchHeroPoolBand, { dossier: { heroPool: ANALYSIS } })
    expect(w.find('.hp-eyebrow').text()).toBe('Hero Pool')

    const pool = w.findAll('[data-pool-hero]')
    expect(pool).toHaveLength(2)
    expect(pool[0]!.text()).toContain('lucio')
    expect(pool[0]!.text()).toContain('12x · 58%')

    expect(w.find('[data-pool-split="pure"]').text()).toContain('13x · 69%')
    expect(w.find('[data-pool-split="out"]').text()).toContain('4x · 25%')

    const out = w.findAll('[data-pool-out-hero]')
    expect(out).toHaveLength(1)
    expect(out[0]!.text()).toContain('ana')
    expect(out[0]!.text()).toContain('1W–2L · 33%')
    expect(out[0]!.find('[data-low-sample]').exists()).toBe(true)
  })

  it('celebrates an empty out-of-pool column', () => {
    const w = mountWidget(MatchHeroPoolBand, {
      dossier: { heroPool: { ...ANALYSIS, outHeroes: [] } },
    })
    expect(w.find('.hp-none').text()).toContain('every game stayed in the pool')
  })

  it('invites play when no pool derives yet', () => {
    const w = mountWidget(MatchHeroPoolBand, { dossier: { heroPool: EMPTY } })
    expect(w.find('.hp-empty').text()).toContain('joins your pool')
    expect(w.findAll('[data-pool-hero]')).toHaveLength(0)
  })
})

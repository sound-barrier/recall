import { describe, it, expect } from 'vitest'
import { nextTick, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useEloCalculator } from '@/composables/elo/useEloCalculator'

let seq = 0
function rec(opts: { result?: string; hero?: string; role?: string; rank?: { tier: string; level: number; progress: number; change?: number } } = {}): MatchRecord {
  seq++
  const iso = new Date(Date.UTC(2026, 5, 30) - seq * 3_600_000).toISOString()
  return {
    match_key: `m${seq}`,
    queue_type: 'role',
    data: {
      playlist: 'competitive',
      hero: opts.hero ?? 'lucio',
      role: opts.role ?? 'support',
      result: opts.result ?? 'victory',
      date: iso.slice(0, 10),
      finished_at: iso.slice(11, 16),
      played_at_utc: iso,
      heroes_played: [{ hero: opts.hero ?? 'lucio', percent_played: 100 }],
      ...(opts.rank ? { rank: opts.rank.tier, level: opts.rank.level, rank_progress: opts.rank.progress, change_percent: opts.rank.change } : {}),
    },
  } as unknown as MatchRecord
}

function supportCorpus(): MatchRecord[] {
  seq = 0
  return [
    rec({ rank: { tier: 'gold', level: 2, progress: 40, change: 22 } }),
    rec({ result: 'defeat', rank: { tier: 'gold', level: 2, progress: 18, change: -20 } }),
    rec({ rank: { tier: 'gold', level: 3, progress: 95, change: 21 } }),
    ...Array.from({ length: 8 }, (_, i) => rec({ hero: 'lucio', result: i < 5 ? 'victory' : 'defeat' })),
    ...Array.from({ length: 3 }, (_, i) => rec({ hero: 'ana', result: i < 1 ? 'victory' : 'defeat' })),
  ]
}

const heroRole = () => 'support'

describe('useEloCalculator', () => {
  it('seeds every input from the default track', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole })
    expect(calc.track.value).toBe('support')
    expect(calc.currentTier.value).toBe('gold')
    expect(calc.currentDivision.value).toBe(2)
    expect(calc.currentProgress.value).toBe(40)
    expect(calc.targetTier.value).toBe('platinum')
    expect(calc.targetDivision.value).toBe(5)
    // 8W/6L = 57.1%.
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
    expect(calc.sampleN.value).toBe(14)
    expect(calc.meterMovePct.value).toBeCloseTo(21, 1)
    expect(calc.projInput.value).not.toBeNull()
    expect(calc.naive.value?.reachable).toBe(true)
  })

  it('re-seeds when the corpus arrives asynchronously (no edits yet)', async () => {
    const records = ref<MatchRecord[]>([])
    const calc = useEloCalculator({ records, heroRole })
    expect(calc.projInput.value).toBeNull()
    records.value = supportCorpus()
    await nextTick()
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('hero selection re-seeds the win rate; clearing restores the track seed', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole })
    calc.toggleHero('lucio')
    // lucio: 6W/3L across the ranked (lucio) games + plain games = check via heroStats.
    const lucio = calc.heroStats.value.find((h) => h.key === 'lucio')!
    expect(calc.winRatePct.value).toBeCloseTo((lucio.wins / (lucio.wins + lucio.losses)) * 100, 1)
    expect(calc.sampleN.value).toBe(lucio.wins + lucio.losses)
    calc.toggleHero('lucio') // deselect → back to the track seed
    expect(calc.sampleN.value).toBe(14)
  })

  it('a manual win-rate edit detaches the hero selection and blocks re-seeding', async () => {
    const records = ref(supportCorpus())
    const calc = useEloCalculator({ records, heroRole })
    calc.toggleHero('lucio')
    expect(calc.selectedHeroes.value.size).toBe(1)
    calc.editInput('winRatePct', 58, { detachHeroes: true })
    expect(calc.selectedHeroes.value.size).toBe(0)
    expect(calc.winRatePct.value).toBe(58)
    // A corpus refresh must NOT clobber the manual edit.
    records.value = [...supportCorpus()]
    await nextTick()
    expect(calc.winRatePct.value).toBe(58)
  })

  it('switching tracks re-fills the whole form (loan-calculator semantics)', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole })
    calc.editInput('winRatePct', 58)
    calc.setTrack('support')
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('produces null projections while inputs are invalid', () => {
    const calc = useEloCalculator({ records: [], heroRole })
    expect(calc.projInput.value).toBeNull()
    expect(calc.naive.value).toBeNull()
    expect(calc.decay.value).toBeNull()
    expect(calc.curves.value).toBeNull()
    expect(calc.pValue.value).toBeNull()
  })

  it('derives the shared statistics from the inputs', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole })
    expect(calc.pValue.value).not.toBeNull()
    expect(calc.percentileNow.value).toBeGreaterThan(0)
    expect(calc.percentileTarget.value).toBeGreaterThan(calc.percentileNow.value!)
    expect(calc.probThisSeason.value).not.toBeNull()
    expect(calc.lossStreak.value).not.toBeNull()
    expect(calc.lossStreak.value!).toBeGreaterThan(0)
  })
})

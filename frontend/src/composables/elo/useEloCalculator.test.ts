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
const mapGameMode = () => 'control'

describe('useEloCalculator', () => {
  it('seeds every input from the default track', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode })
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
    const calc = useEloCalculator({ records, heroRole, mapGameMode })
    expect(calc.projInput.value).toBeNull()
    records.value = supportCorpus()
    await nextTick()
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('hero selection re-seeds the win rate; clearing restores the track seed', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode })
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
    const calc = useEloCalculator({ records, heroRole, mapGameMode })
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
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode })
    calc.editInput('winRatePct', 58)
    calc.setTrack('support')
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('produces null projections while inputs are invalid', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode })
    expect(calc.projInput.value).toBeNull()
    expect(calc.naive.value).toBeNull()
    expect(calc.decay.value).toBeNull()
    expect(calc.curves.value).toBeNull()
    expect(calc.pValue.value).toBeNull()
  })

  it('derives the shared statistics from the inputs', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode })
    expect(calc.pValue.value).not.toBeNull()
    expect(calc.percentileNow.value).toBeGreaterThan(0)
    expect(calc.percentileTarget.value).toBeGreaterThan(calc.percentileNow.value!)
    expect(calc.probThisSeason.value).not.toBeNull()
    expect(calc.lossStreak.value).not.toBeNull()
    expect(calc.lossStreak.value!).toBeGreaterThan(0)
  })
})

describe('useEloCalculator — statistics layer', () => {
  // Two rank bands with a falling win rate (30 games each), plus per-10
  // performance stats: measurable slope, runnable runs test, live drivers.
  function climbCorpus(): MatchRecord[] {
    seq = 0
    const rows: MatchRecord[] = []
    for (let i = 0; i < 60; i++) {
      const old = i < 30
      const win = old ? i % 10 < 7 : i % 10 < 6
      const r = rec({
        result: win ? 'victory' : 'defeat',
        rank: { tier: 'gold', level: old ? 5 : 2, progress: 0, change: win ? 20 : -20 },
      })
      ;(r.data as Record<string, unknown>).performance = {
        deaths: { total: 5, avg_per_10min: (win ? 4 : 6.5) + (i % 3) * 0.2 },
      }
      rows.push(r)
    }
    // rec() makes later seq OLDER, so reverse: the high-rank band must be newest.
    return rows.reverse()
  }

  it('seeds the decay slope from the measured climb', () => {
    const calc = useEloCalculator({ records: climbCorpus(), heroRole, mapGameMode })
    expect(calc.lastSeed.value?.decaySlope).not.toBeNull()
    // Seeded input = the measured value, clamped into the 0.5–5 band.
    expect(calc.decaySlopePts.value).toBeGreaterThanOrEqual(0.5)
    expect(calc.decaySlopePts.value).toBeLessThanOrEqual(5)
    expect(calc.decaySlopePts.value).not.toBe(1.5)
  })

  it('keeps the default slope when the climb is unmeasurable', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode })
    expect(calc.lastSeed.value?.decaySlope ?? null).toBeNull()
    expect(calc.decaySlopePts.value).toBe(1.5)
  })

  it('exposes the Bayesian readouts, the runs test, and the stat drivers', () => {
    const calc = useEloCalculator({ records: climbCorpus(), heroRole, mapGameMode })
    expect(calc.skepticVerdict.value).toBeGreaterThan(0.5)
    expect(calc.skepticVerdict.value).toBeLessThanOrEqual(1)
    const iv = calc.trueRateRange.value!
    expect(iv.lower).toBeLessThan(iv.upper)
    const q = calc.climbQuantiles.value!
    expect(q.p50).not.toBeNull()
    expect(calc.gamesToCertainty.value).toBeGreaterThan(0)
    const runs = calc.runs.value!
    expect(runs.pValue).toBeGreaterThan(0)
    expect(runs.nWins + runs.nLosses).toBe(60)
    const drivers = calc.drivers.value
    expect(drivers[0]!.key).toBe('deaths')
    expect(drivers[0]!.winMean).toBeLessThan(drivers[0]!.lossMean)
  })

  it('nulls the Bayesian readouts while inputs are invalid', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode })
    expect(calc.skepticVerdict.value).toBeNull()
    expect(calc.trueRateRange.value).toBeNull()
    expect(calc.climbQuantiles.value).toBeNull()
    expect(calc.gamesToCertainty.value).toBeNull()
    expect(calc.runs.value).toBeNull()
    expect(calc.drivers.value).toEqual([])
  })
})

describe('useEloCalculator — phase 2 (simulator + skill curve)', () => {
  it('exposes the season simulation and the skill curve on a rank-rich corpus', () => {
    const calc = useEloCalculator({ mapGameMode, records: (function climb() {
      seq = 0
      const rows: MatchRecord[] = []
      for (let i = 0; i < 60; i++) {
        const old = i < 30
        const win = old ? i % 10 < 7 : i % 10 < 6
        rows.push(rec({
          result: win ? 'victory' : 'defeat',
          rank: { tier: 'gold', level: old ? 5 : 2, progress: 0, change: win ? 20 : -20 },
        }))
      }
      return rows.reverse()
    })(), heroRole })
    const sim = calc.seasonSim.value!
    expect(sim).not.toBeNull()
    expect(sim.usedEmpiricalMeter).toBe(true) // 60 rank cards feed both pools
    expect(sim.probReachTarget).toBeGreaterThan(0)
    expect(sim.fan.games[0]).toBe(0)
    const curve = calc.skillCurve.value!
    expect(curve).not.toBeNull()
    expect(curve.n).toBe(60)
    expect(curve.signalShare).toBeGreaterThan(0)
    expect(curve.signalShare).toBeLessThanOrEqual(1)
  })

  it('nulls both when there is nothing to simulate or filter', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode })
    expect(calc.seasonSim.value).toBeNull()
    expect(calc.skillCurve.value).toBeNull()
  })
})

describe('useEloCalculator — phase 3 (change-point + lift)', () => {
  it('exposes both on suitable corpora and nulls on empty', () => {
    // rec() makes later seq OLDER, so building winny-then-lossy yields a
    // chronological lossy→winny corpus — an upward 40-pt break. (The
    // timeline sorts by timestamp; array order is irrelevant.)
    seq = 0
    const rows: MatchRecord[] = []
    for (let i = 0; i < 100; i++) {
      const winnyBlock = i < 50
      rows.push(rec({ result: (winnyBlock ? i % 5 !== 4 : i % 5 < 2) ? 'victory' : 'defeat' }))
    }
    const calc = useEloCalculator({ records: rows, heroRole, mapGameMode })
    const cp = calc.changePoint.value
    expect(cp).not.toBeNull()
    expect(cp!.point.deltaPts).toBeGreaterThanOrEqual(30)
    expect(calc.lift.value.length).toBeGreaterThan(0)

    const empty = useEloCalculator({ records: [], heroRole, mapGameMode })
    expect(empty.changePoint.value).toBeNull()
    expect(empty.lift.value).toEqual([])
  })
})

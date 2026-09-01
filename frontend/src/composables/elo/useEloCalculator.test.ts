import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { nextTick, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import type { GoalPace } from '@/match/elo/elo-model'
import { useEloCalc, useEloCalculator } from '@/composables/elo/useEloCalculator'
import { installMemoryLocalStorage } from '@/test-utils'

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
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
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
    const calc = useEloCalculator({ records, heroRole, mapGameMode , seasons: [] })
    expect(calc.projInput.value).toBeNull()
    records.value = supportCorpus()
    await nextTick()
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('hero selection re-seeds the win rate; clearing restores the track seed', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
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
    const calc = useEloCalculator({ records, heroRole, mapGameMode , seasons: [] })
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
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.editInput('winRatePct', 58)
    calc.setTrack('support')
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('produces null projections while inputs are invalid', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode , seasons: [] })
    expect(calc.projInput.value).toBeNull()
    expect(calc.naive.value).toBeNull()
    expect(calc.decay.value).toBeNull()
    expect(calc.curves.value).toBeNull()
    expect(calc.pValue.value).toBeNull()
  })

  it('derives the shared statistics from the inputs', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.pValue.value).not.toBeNull()
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
    const calc = useEloCalculator({ records: climbCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.lastSeed.value?.decaySlope).not.toBeNull()
    // Seeded input = the measured value, clamped into the 0.5–5 band.
    expect(calc.decaySlopePts.value).toBeGreaterThanOrEqual(0.5)
    expect(calc.decaySlopePts.value).toBeLessThanOrEqual(5)
    expect(calc.decaySlopePts.value).not.toBe(1.5)
  })

  it('keeps the default slope when the climb is unmeasurable', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.lastSeed.value?.decaySlope ?? null).toBeNull()
    expect(calc.decaySlopePts.value).toBe(1.5)
  })

  it('exposes the Bayesian readouts, the runs test, and the stat drivers', () => {
    const calc = useEloCalculator({ records: climbCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.skepticVerdict.value).toBeGreaterThan(0.5)
    expect(calc.skepticVerdict.value).toBeLessThanOrEqual(1)
    const iv = calc.trueRateRange.value!
    expect(iv.lower).toBeLessThan(iv.upper)
    expect(calc.gamesToCertainty.value).toBeGreaterThan(0)
    const runs = calc.runs.value!
    expect(runs.pValue).toBeGreaterThan(0)
    expect(runs.nWins + runs.nLosses).toBe(60)
  })

  it('nulls the Bayesian readouts while inputs are invalid', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode , seasons: [] })
    expect(calc.skepticVerdict.value).toBeNull()
    expect(calc.trueRateRange.value).toBeNull()
    expect(calc.gamesToCertainty.value).toBeNull()
    expect(calc.runs.value).toBeNull()
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
    })(), heroRole, seasons: [] })
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

  it('the season probability IS the simulator reach share, decay included', () => {
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
    const calc = useEloCalculator({ mapGameMode, records: rows.reverse(), heroRole , seasons: [] })
    const sim = calc.seasonSim.value!
    expect(sim).not.toBeNull()
    expect(calc.probThisSeason.value).toBe(sim.probReachTarget)
    // Measured pace exists on this corpus — no assumed-pace disclaimer.
    expect(calc.paceAssumed.value).toBe(false)
    expect(calc.simHorizonGames.value).toBe(calc.seasonGames.value)
    // The measured-baseline sim exists and agrees before any edits.
    expect(calc.measuredSeasonSim.value?.probReachTarget).toBe(sim.probReachTarget)
  })

  it('nulls both when there is nothing to simulate or filter', () => {
    const calc = useEloCalculator({ records: [], heroRole, mapGameMode , seasons: [] })
    expect(calc.seasonSim.value).toBeNull()
    expect(calc.skillCurve.value).toBeNull()
  })
})

describe('useEloCalculator — edited state + measured baseline', () => {
  it('is unedited at the seed and flips on any of the three edit sources', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.isEdited.value).toBe(false)

    calc.editInput('winRatePct', 62)
    expect(calc.editedFields.value.winRatePct).toBe(true)
    expect(calc.isEdited.value).toBe(true)
    calc.resetToMeasured()
    expect(calc.isEdited.value).toBe(false)
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)

    calc.toggleHero('lucio')
    expect(calc.isEdited.value).toBe(true)
    calc.resetToMeasured()
    expect(calc.isEdited.value).toBe(false)

    calc.bumpHero('lucio', 1)
    expect(calc.isEdited.value).toBe(true)
    calc.resetToMeasured()
    expect(calc.isEdited.value).toBe(false)
  })

  it('holds the measured projection steady while the live one follows the edit', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    const measuredBefore = calc.measuredNaive.value!.expectedGames
    const liveBefore = calc.naive.value!.expectedGames
    expect(measuredBefore).toBe(liveBefore)

    calc.editInput('winRatePct', 70)
    expect(calc.measuredNaive.value!.expectedGames).toBe(measuredBefore)
    expect(calc.naive.value!.expectedGames).not.toBe(liveBefore)
  })

  it('re-snapshots the baseline when the track re-seeds', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.editInput('winRatePct', 70)
    calc.setTrack('support')
    expect(calc.isEdited.value).toBe(false)
    expect(calc.editedFields.value.winRatePct).toBe(false)
  })
})

describe('useEloCalculator — hero what-if nudges', () => {
  // supportCorpus per hero: lucio 7W/4L (n=11, 64%), ana 1W/2L (n=3, 33%);
  // track sample 8W/6L = 57.1% over 14.
  it('a nudge shifts the effective rate by the hero share; the input stays measured', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.bumpHero('lucio', 1)
    expect(calc.winRatePct.value).toBeCloseTo(57.1, 1)
    expect(calc.effectiveWinRatePct.value).toBeCloseTo(57.9, 1) // 57.1 + 11/14·1
    expect(calc.projInput.value!.winRate).toBeCloseTo(0.579, 3)
    expect(calc.whatIf.value.perHero.get('lucio')).toEqual({ from: 64, to: 65 })
    calc.bumpHero('lucio', -1)
    expect(calc.effectiveWinRatePct.value).toBeCloseTo(57.1, 1)
  })

  it('a nudge never rewrites the sample the statistics are computed from', () => {
    // The what-if dial prices hypothetical games; the p-value, posterior,
    // credible interval and games-to-certainty are statements about games
    // actually played. Pre-fix, a nudge forged sampleWins from the nudged
    // rate and every one of them moved.
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    const before = {
      p: calc.pValue.value,
      skeptic: calc.skepticVerdict.value,
      range: calc.trueRateRange.value,
      know: calc.gamesToCertainty.value,
      wins: calc.projInput.value!.sampleWins,
    }
    for (let i = 0; i < 5; i++) calc.bumpHero('lucio', 1)
    expect(calc.projInput.value!.sampleWins).toBe(before.wins)
    expect(calc.pValue.value).toBe(before.p)
    expect(calc.skepticVerdict.value).toBe(before.skeptic)
    expect(calc.trueRateRange.value).toEqual(before.range)
    expect(calc.gamesToCertainty.value).toBe(before.know)
    // The projections DO follow the dial.
    expect(calc.projInput.value!.winRate).toBeGreaterThan(0.571)
  })

  it('the season sim follows a nudge as a location shift, not extra games', () => {
    seq = 0
    const rows: MatchRecord[] = []
    for (let i = 0; i < 60; i++) {
      const win = i % 10 < 6
      rows.push(rec({
        result: win ? 'victory' : 'defeat',
        rank: { tier: 'gold', level: i < 30 ? 4 : 3, progress: 0, change: win ? 20 : -20 },
      }))
    }
    const calc = useEloCalculator({ records: rows.reverse(), heroRole, mapGameMode , seasons: [] })
    const before = calc.seasonSim.value!
    for (let i = 0; i < 5; i++) calc.bumpHero('lucio', 1)
    const after = calc.seasonSim.value!
    expect(after.probReachTarget).toBeGreaterThan(before.probReachTarget)
    // Same real sample feeds the posterior width in both runs.
    expect(calc.projInput.value!.sampleWins + calc.projInput.value!.sampleLosses).toBe(calc.sampleN.value)
  })

  it('saturates 5 points from the measured rate', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    for (let i = 0; i < 9; i++) calc.bumpHero('lucio', 1)
    expect(calc.heroAdjustPts.value.get('lucio')).toBe(5)
    expect(calc.whatIf.value.perHero.get('lucio')).toEqual({ from: 64, to: 69 })
    for (let i = 0; i < 14; i++) calc.bumpHero('lucio', -1)
    expect(calc.heroAdjustPts.value.get('lucio')).toBe(-5)
    expect(calc.whatIf.value.perHero.get('lucio')).toEqual({ from: 64, to: 59 })
  })

  it('a selection narrows the scope to the selected heroes', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.toggleHero('lucio')
    calc.bumpHero('lucio', 1)
    // The sample IS lucio now, so the whole +1 lands: 63.6 → 64.6.
    expect(calc.effectiveWinRatePct.value).toBeCloseTo(64.6, 1)
    calc.bumpHero('ana', 1) // out of scope — no effect while selected
    expect(calc.effectiveWinRatePct.value).toBeCloseTo(64.6, 1)
    expect(calc.whatIf.value.perHero.has('ana')).toBe(false)
  })

  it('selecting overlapping heroes caps the sample at real matches', () => {
    // Ten matches, every one meaningfully played on BOTH lucio and ana:
    // pooled per-hero credit says 20 games; the evidence is 10.
    seq = 0
    const rows: MatchRecord[] = []
    for (let i = 0; i < 10; i++) {
      const r = rec({ result: i % 2 === 0 ? 'victory' : 'defeat', hero: 'lucio' })
      ;(r.data as { heroes_played: unknown[] }).heroes_played = [
        { hero: 'lucio', percent_played: 60, play_time: '06:00' },
        { hero: 'ana', percent_played: 40, play_time: '04:00' },
      ]
      rows.push(r)
    }
    const calc = useEloCalculator({ records: rows, heroRole, mapGameMode , seasons: [] })
    calc.toggleHero('lucio')
    calc.toggleHero('ana')
    expect(calc.sampleN.value).toBe(10)
  })

  it('reset, track re-seed, and a detaching manual edit all clear the nudges', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.bumpHero('lucio', 1)
    calc.resetHeroAdjust()
    expect(calc.heroAdjustPts.value.size).toBe(0)
    expect(calc.effectiveWinRatePct.value).toBeCloseTo(57.1, 1)

    calc.bumpHero('lucio', 1)
    calc.setTrack('support')
    expect(calc.heroAdjustPts.value.size).toBe(0)

    calc.bumpHero('lucio', 1)
    calc.editInput('winRatePct', 58, { detachHeroes: true })
    expect(calc.heroAdjustPts.value.size).toBe(0)
    expect(calc.effectiveWinRatePct.value).toBe(58)
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
    const calc = useEloCalculator({ records: rows, heroRole, mapGameMode , seasons: [] })
    const cp = calc.changePoint.value
    expect(cp).not.toBeNull()
    expect(cp!.point.deltaPts).toBeGreaterThanOrEqual(30)
    expect(calc.lift.value.length).toBeGreaterThan(0)

    const empty = useEloCalculator({ records: [], heroRole, mapGameMode , seasons: [] })
    expect(empty.changePoint.value).toBeNull()
    expect(empty.lift.value).toEqual([])
  })
})

describe('useEloCalculator — track availability and the seed boundaries', () => {
  it('offers every track with its evidence, and follows a late-arriving default', async () => {
    const records = ref<MatchRecord[]>([])
    const calc = useEloCalculator({ records, heroRole, mapGameMode , seasons: [] })
    expect(calc.tracks.value.map((t) => t.key)).toEqual(['tank', 'dps', 'support', 'open'])
    expect(calc.tracks.value.every((t) => t.decisiveN === 0 && !t.hasRank)).toBe(true)

    records.value = supportCorpus()
    await nextTick()
    expect(calc.track.value).toBe('support')
    expect(calc.tracks.value.find((t) => t.key === 'support')).toMatchObject({ hasRank: true, decisiveN: 14 })
  })

  it("leaves a user's chosen track alone when the corpus's default changes under it", async () => {
    const records = ref<MatchRecord[]>([])
    const calc = useEloCalculator({ records, heroRole, mapGameMode , seasons: [] })
    calc.setTrack('dps')
    records.value = supportCorpus()
    await nextTick()
    expect(calc.track.value).toBe('dps')
  })

  it('clamps the default target at the top of the ladder', () => {
    seq = 0
    const top = [
      rec({ rank: { tier: 'champion', level: 3, progress: 20, change: 18 } }),
      rec({ result: 'defeat', rank: { tier: 'champion', level: 3, progress: 2, change: -18 } }),
      rec({ rank: { tier: 'champion', level: 4, progress: 90, change: 19 } }),
    ]
    const calc = useEloCalculator({ records: top, heroRole, mapGameMode , seasons: [] })
    expect(calc.currentTier.value).toBe('champion')
    // One tier up from Champion is Champion — and its top division, not 5.
    expect(calc.targetTier.value).toBe('champion')
    expect(calc.targetDivision.value).toBe(1)
  })
})

describe('useEloCalculator — the season window', () => {
  it('prices the season at the measured pace', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.gamesPerWeekInput.value).toBe(14)
    expect(calc.seasonGames.value).toBe(168) // 14/week × a 12-week season
    expect(calc.paceAssumed.value).toBe(false)
    expect(calc.simHorizonGames.value).toBe(168)
    const required = calc.requiredWrForSeason.value!
    expect(required).toBeGreaterThan(0.5)
    expect(required).toBeLessThan(1)
  })

  it('assumes a typical week when the pace is unknown, and says the season is unpriceable', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    calc.editInput('gamesPerWeekInput', null)
    expect(calc.seasonGames.value).toBeNull()
    expect(calc.paceAssumed.value).toBe(true)
    expect(calc.simHorizonGames.value).toBe(120) // 10 games/week × 12 weeks
    // No pace means no calendar answer — neither weeks nor a season rate.
    expect(calc.requiredWrForSeason.value).toBeNull()
    expect(calc.weeksNaive.value).toBeNull()
    expect(calc.weeksDecay.value).toBeNull()
  })
})

describe('useEloCalculator — the ceiling range and the early-read floor', () => {
  // The same rate held across three divisions of climb: the fitted slope
  // is ~0 and its CI reaches below the model's floor, so no top can be
  // bounded — the "still consistent with an improver" case.
  function bandLevel(i: number): number {
    if (i < 20) return 2
    if (i < 40) return 3
    return 5
  }

  function flatSlopeCorpus(): MatchRecord[] {
    seq = 0
    const rows: MatchRecord[] = []
    for (let i = 0; i < 60; i++) {
      const win = i % 10 < 6
      rows.push(rec({
        result: win ? 'victory' : 'defeat',
        rank: { tier: 'gold', level: bandLevel(i), progress: 50, change: win ? 20 : -20 },
      }))
    }
    return rows.reverse()
  }

  it('drops the measured slope CI as soon as the dial is overridden', () => {
    const calc = useEloCalculator({ records: flatSlopeCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.lastSeed.value?.decaySlope?.lowerPts).toBeLessThan(0.5)
    expect(calc.ceiling.value?.hi).toBeNull() // the measurement can't bound the top

    // A chosen slope carries no sampling uncertainty, so the envelope closes.
    calc.editInput('decaySlopePts', 1.5)
    expect(calc.ceiling.value?.hi).not.toBeNull()
  })

  it('flags a sample below the early-read floor, but not an empty one', () => {
    const calc = useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode , seasons: [] })
    expect(calc.provisional.value).toBe(true) // 14 decisive games
    calc.editInput('sampleN', 19)
    expect(calc.provisional.value).toBe(true)
    calc.editInput('sampleN', 20)
    expect(calc.provisional.value).toBe(false)
    calc.editInput('sampleN', 0)
    expect(calc.provisional.value).toBe(false) // nothing measured isn't "provisional"
  })

  it('has nothing to quote at all without a projection', () => {
    const empty = useEloCalculator({ records: [], heroRole, mapGameMode , seasons: [] })
    expect(empty.ceiling.value).toBeNull()
    expect(empty.provisional.value).toBe(false)
    expect(empty.probThisSeason.value).toBeNull()
    expect(empty.requiredWrForSeason.value).toBeNull()
    expect(empty.lossStreak.value).toBeNull()
    expect(empty.heroGap.value).toBeNull()
    // The measured baseline the delta strip prices edits against is empty too.
    expect(empty.measuredNaive.value).toBeNull()
    expect(empty.measuredWeeks.value).toBeNull()
    expect(empty.measuredProbSeason.value).toBeNull()
  })
})

describe('useEloCalculator — hero evidence', () => {
  function twoHeroCorpus(): MatchRecord[] {
    seq = 0
    return [
      ...Array.from({ length: 20 }, (_, i) => rec({ hero: 'lucio', result: i < 14 ? 'victory' : 'defeat' })),
      ...Array.from({ length: 20 }, (_, i) => rec({ hero: 'ana', result: i < 8 ? 'victory' : 'defeat' })),
    ]
  }

  it('prices the best-vs-worst hero gap only once two heroes have real evidence', () => {
    const gap = useEloCalculator({ records: twoHeroCorpus(), heroRole, mapGameMode , seasons: [] }).heroGap.value!
    expect(gap.best.key).toBe('lucio')
    expect(gap.worst.key).toBe('ana')
    expect(gap.gapPerGamePts).toBeGreaterThan(0)

    // One hero, however long the record, has nothing to compare against.
    seq = 0
    const soloRecords = Array.from({ length: 20 }, (_, i) => rec({ hero: 'lucio', result: i < 14 ? 'victory' : 'defeat' }))
    expect(useEloCalculator({ records: soloRecords, heroRole, mapGameMode , seasons: [] }).heroGap.value).toBeNull()
  })
})

describe('the climb goal', () => {
  beforeEach(() => {
    installMemoryLocalStorage()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-30T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  const calc = () => useEloCalculator({ records: supportCorpus(), heroRole, mapGameMode, seasons: [] })

  it('carries the goal over to the next session', () => {
    const first = calc()
    first.pickTargetTier('diamond')
    first.pickTargetDivision(2)
    first.pickTargetBy('2026-12-01')

    // A second instance stands in for the next launch: it reads the same
    // storage the first one wrote, without being handed anything.
    const next = calc()
    expect(next.targetTier.value).toBe('diamond')
    expect(next.targetDivision.value).toBe(2)
    expect(next.targetBy.value).toBe('2026-12-01')
  })

  it('falls back to the default goal when storage holds something unreadable', () => {
    localStorage.setItem('recall.elo.targetTier', 'wood')
    // 9 is REJECTED, not clamped: a clamp would land on 5, which is also the
    // derived default, and the assertion below would pass with no fallback.
    localStorage.setItem('recall.elo.targetDivision', '9')
    localStorage.setItem('recall.elo.targetBy', 'someday')

    const c = calc()
    expect(c.targetTier.value).toBe('platinum')
    expect(c.targetDivision.value).toBe(5)
    expect(c.targetBy.value).toBe('')
  })

  it('says nothing about pace until a deadline is set', () => {
    const c = calc()
    expect(c.targetBy.value).toBe('')
    expect(c.goalPace.value).toBeNull()
  })

  // Narrowing helper: every assertion below is about a pace the model
  // could actually measure, and the union's other arms carry no weeks.
  function measured(pace: GoalPace | null) {
    expect(pace?.kind).toBe('measured')
    return pace as Extract<GoalPace, { kind: 'measured' }>
  }

  it('measures the deadline against the decay-aware weeks, not the naive ones', () => {
    const c = calc()
    c.pickTargetBy('2026-12-01')
    const pace = measured(c.goalPace.value)
    // 2026-06-30T12:00Z → 2026-12-01 is 153.5 days, 21.9 weeks.
    expect(pace.weeksLeft).toBeCloseTo(21.9, 1)
    expect(pace.weeksNeeded).toBeCloseTo(c.weeksDecay.value!, 1)
    expect(pace.weeksNeeded).not.toBeCloseTo(c.weeksNaive.value!, 1)
  })

  it('judges a reachable deadline on pace and a passed one behind', () => {
    const c = calc()
    c.pickTargetBy('2029-01-01')
    expect(measured(c.goalPace.value).onPace).toBe(true)

    c.pickTargetBy('2026-06-29')
    expect(measured(c.goalPace.value).onPace).toBe(false)
    expect(measured(c.goalPace.value).weeksLeft).toBeLessThan(0)
  })

  it('keeps the three ways a deadline can go unanswered apart', () => {
    const c = calc()
    c.pickTargetBy('2027-01-01')
    c.editInput('gamesPerWeekInput', null)
    expect(c.goalPace.value?.kind).toBe('no-pace')

    c.editInput('gamesPerWeekInput', 10)
    // Champion 1 from Gold 2 is past where this record's climb plateaus.
    c.pickTargetTier('champion')
    c.pickTargetDivision(1)
    expect(c.goalPace.value?.kind).toBe('unreachable')

    // An emptied record projects nothing at all. Calling THAT "out of reach"
    // blames the goal for a gap in the inputs.
    c.editInput('sampleN', 0)
    expect(c.goalPace.value?.kind).toBe('no-projection')

    // The calendar half of the answer survives all three.
    expect(c.goalPace.value!.weeksLeft).toBeGreaterThan(0)
  })

  it('gives the goal back to the measured default on a reset', () => {
    // The pick is persisted, so without a clear here a goal could be set and
    // never unset: the target stopped following the player's rank and the
    // edited marker stayed lit forever.
    const c = calc()
    c.pickTargetTier('champion')
    c.pickTargetDivision(1)
    c.pickTargetBy('2027-01-01')
    expect(c.targetTier.value).toBe('champion')

    c.resetToMeasured()
    expect(c.targetTier.value).toBe('platinum')
    expect(c.targetDivision.value).toBe(5)
    expect(c.targetBy.value).toBe('')
    expect(c.goalPace.value).toBeNull()
  })
})

describe('useEloCalc', () => {
  it('fails loudly when a panel is used outside the calculator provider', () => {
    expect(() => useEloCalc()).toThrow('useEloCalc() called outside an EloCalculatorView provider.')
  })
})

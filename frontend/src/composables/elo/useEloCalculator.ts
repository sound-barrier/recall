import {
  computed, inject, provide, ref, toValue, watch,
  type ComputedRef, type InjectionKey, type MaybeRefOrGetter, type Ref,
} from 'vue'
import type { MatchRecord } from '@/api-client'
import { TIER_ORDER, ladderScore, rankLadderSeries, type Tier } from '@/match/match-trends-helpers'
import {
  availableTracks, heroPickerStats, pooledWinLoss, seedTrack, trackRecords,
  TRACK_LABELS, type HeroPickStat, type TrackKey, type TrackSeed,
} from '@/match/elo-seed'
import {
  decayProjection, gamesToWeeks, naiveProjection, probWithinGames, projectionCurves,
  requiredWinRateForGames, DEFAULT_DECAY_SLOPE, DEFAULT_METER_MOVE_PCT,
  type DecayProjection, type NaiveProjection, type ProjectionCurves, type ProjectionInput,
} from '@/match/elo-model'
import { binomialTwoSidedP, lossStreakChance, runsTest } from '@/match/elo-stats'
import {
  credibleInterval, gamesToKnow, posteriorClimbQuantiles, probTrueWinRateAbove,
} from '@/match/elo-bayes'
import { decisiveResults, decisiveTimeline } from '@/match/elo-streaks'
import { meterMoveSamples, simulateSeasons, type SeasonSim } from '@/match/elo-simulate'
import { skillCurve as computeSkillCurve, type SkillCurve } from '@/match/elo-kalman'
import {
  changePointContext, detectChangePoint, type ChangePoint, type ChangePointContext,
} from '@/match/elo-changepoint'
import { liftTable, type LiftRow } from '@/match/elo-lift'
import { clampHeroAdjust, heroWhatIf, type HeroWhatIf } from '@/match/elo-whatif'
import { heroClimbGap, type HeroGap } from '@/match/elo-hero-gap'
import { populationPercentile } from '@/match/elo-distribution'

// The Elo Calculator's single state owner (loan-calculator semantics):
// picking a track re-fills every input from that track's history; every
// input stays editable; a manual edit stops background re-seeding so
// the user's numbers never fight the data. Provided to the elo/*
// components via inject, mirroring the dashboard's useDossier seam.

export interface EloCalcOpts {
  records: MaybeRefOrGetter<MatchRecord[]>
  heroRole: (hero: string | null | undefined) => string
  mapGameMode: (map: string | null | undefined) => string
}

// SEASON_WEEKS sizes the "this season" probability window.
const SEASON_WEEKS = 12
// The loss-streak reality check: odds of a run this long within this many
// decisive games — the "streaks are normal, not rigged" number.
const STREAK_LEN = 5
const STREAK_HORIZON = 100
// KNOW_HALF_WIDTH: the ±3-point target behind "games to certainty".
const KNOW_HALF_WIDTH = 0.03
// The decay-slope input's editable band (mirrored by the form's min/max);
// a measured slope seeds inside it.
const SLOPE_PTS_MIN = 0.5
const SLOPE_PTS_MAX = 5

export function useEloCalculator(opts: EloCalcOpts) {
  const records = computed(() => toValue(opts.records))
  const tracksInfo = computed(() => availableTracks(records.value))

  const track = ref<TrackKey>(tracksInfo.value.defaultTrack)
  const trackPicked = ref(false)
  const dirty = ref(false)

  // ── Editable inputs (all seeded, all overridable) ──────────────────
  const currentTier = ref<Tier>('gold')
  const currentDivision = ref(3)
  const currentProgress = ref(0)
  const targetTier = ref<Tier>('platinum')
  const targetDivision = ref(5)
  const winRatePct = ref<number | null>(null)
  const sampleN = ref(0)
  const meterMovePct = ref(DEFAULT_METER_MOVE_PCT)
  const gamesPerWeekInput = ref<number | null>(null)
  const decaySlopePts = ref(DEFAULT_DECAY_SLOPE * 100)

  const selectedHeroes = ref<ReadonlySet<string>>(new Set())
  const heroAdjustPts = ref<ReadonlyMap<string, number>>(new Map())
  const lastSeed = ref<TrackSeed | null>(null)

  const seed = computed(() => seedTrack(records.value, track.value))

  function applySeed(): void {
    const s = seed.value
    lastSeed.value = s
    if (s.rank) {
      currentTier.value = s.rank.tier
      currentDivision.value = s.rank.level
      currentProgress.value = Math.max(0, s.rank.progress)
    }
    applyTargetDefault(s.rank?.tier ?? currentTier.value)
    winRatePct.value = s.winRate === null ? null : round1(s.winRate * 100)
    sampleN.value = s.wins + s.losses
    meterMovePct.value = round1(s.meterMovePct)
    gamesPerWeekInput.value = s.gamesPerWeek === null ? null : round1(s.gamesPerWeek)
    decaySlopePts.value = s.decaySlope === null
      ? DEFAULT_DECAY_SLOPE * 100
      : Math.min(SLOPE_PTS_MAX, Math.max(SLOPE_PTS_MIN, round1(s.decaySlope.pts)))
    selectedHeroes.value = new Set()
    heroAdjustPts.value = new Map()
    dirty.value = false
  }

  // Default target: one tier up, division 5 (Champion tops out at 1).
  function applyTargetDefault(fromTier: Tier): void {
    const idx = (TIER_ORDER as readonly string[]).indexOf(fromTier)
    const next = Math.min(idx + 1, TIER_ORDER.length - 1)
    targetTier.value = TIER_ORDER[next] ?? 'champion'
    targetDivision.value = next === idx ? 1 : 5
  }

  function setTrack(next: TrackKey): void {
    trackPicked.value = true
    track.value = next
    applySeed()
  }

  // Re-seed when the corpus loads/changes — but never over a user's edits.
  watch(seed, () => {
    if (!dirty.value) applySeed()
  }, { immediate: true })
  watch(() => tracksInfo.value.defaultTrack, (next) => {
    if (!trackPicked.value && !dirty.value) track.value = next
  })

  // ── Hero picker → win-rate reseeding ───────────────────────────────
  const trackRecs = computed(() => trackRecords(records.value, track.value))
  const heroStats: ComputedRef<HeroPickStat[]> = computed(() => heroPickerStats(trackRecs.value, opts.heroRole))

  function toggleHero(key: string): void {
    const next = new Set(selectedHeroes.value)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    selectedHeroes.value = next
    dirty.value = true
    applyHeroSelection(next)
  }

  function applyHeroSelection(selection: ReadonlySet<string>): void {
    if (selection.size === 0) {
      const s = seed.value
      winRatePct.value = s.winRate === null ? null : round1(s.winRate * 100)
      sampleN.value = s.wins + s.losses
      return
    }
    const { wins, losses } = pooledWinLoss(heroStats.value, selection)
    winRatePct.value = wins + losses > 0 ? round1((wins / (wins + losses)) * 100) : null
    sampleN.value = wins + losses
  }

  // ── Hero what-if nudges (1-point arrows, capped at ±5) ─────────────
  // A layered hypothesis, not an edit: the measured inputs stay put and
  // every projection reads the nudged blend through effectiveWinRatePct.
  function bumpHero(key: string, dir: 1 | -1): void {
    const next = new Map(heroAdjustPts.value)
    const stepped = clampHeroAdjust(next.get(key) ?? 0, dir)
    if (stepped === 0) next.delete(key)
    else next.set(key, stepped)
    heroAdjustPts.value = next
  }
  function resetHeroAdjust(): void {
    heroAdjustPts.value = new Map()
  }

  const whatIf = computed<HeroWhatIf>(() =>
    heroWhatIf(heroStats.value, selectedHeroes.value, sampleN.value, heroAdjustPts.value))
  const effectiveWinRatePct = computed<number | null>(() => {
    if (winRatePct.value === null) return null
    const delta = whatIf.value.deltaPts
    if (delta === 0) return winRatePct.value
    return round1(Math.max(0, Math.min(100, winRatePct.value + delta)))
  })

  // Manual edits are name-keyed (templates auto-unwrap destructured refs,
  // so they can't pass the ref itself). Every edit marks the form dirty;
  // win-rate/sample edits also detach the hero selection so the two
  // sources never fight.
  const editable = {
    currentTier, currentDivision, currentProgress, targetTier, targetDivision,
    winRatePct, sampleN, meterMovePct, gamesPerWeekInput, decaySlopePts,
  }
  function editInput(
    field: keyof typeof editable,
    value: number | string | null,
    opts2?: { detachHeroes?: boolean },
  ): void {
    ;(editable[field] as Ref<number | string | null>).value = value
    dirty.value = true
    if (opts2?.detachHeroes) {
      selectedHeroes.value = new Set()
      heroAdjustPts.value = new Map()
    }
  }

  // ── Derived projections ────────────────────────────────────────────
  const currentScore = computed(() => ladderScore(currentTier.value, currentDivision.value, currentProgress.value))
  const targetScore = computed(() => ladderScore(targetTier.value, targetDivision.value, 0))

  const projInput = computed<ProjectionInput | null>(() => {
    if (currentScore.value === null || targetScore.value === null) return null
    const rate = effectiveWinRatePct.value
    if (rate === null || sampleN.value <= 0 || meterMovePct.value <= 0) return null
    const wins = Math.round((sampleN.value * rate) / 100)
    return {
      currentScore: currentScore.value,
      targetScore: targetScore.value,
      winRate: rate / 100,
      sampleWins: wins,
      sampleLosses: sampleN.value - wins,
      meterMovePct: meterMovePct.value,
      decaySlope: decaySlopePts.value / 100,
    }
  })

  const naive = computed<NaiveProjection | null>(() => (projInput.value ? naiveProjection(projInput.value) : null))
  const decay = computed<DecayProjection | null>(() => (projInput.value ? decayProjection(projInput.value) : null))
  const curves = computed<ProjectionCurves | null>(() => (projInput.value ? projectionCurves(projInput.value) : null))

  const pValue = computed(() => {
    const inp = projInput.value
    return inp ? binomialTwoSidedP(inp.sampleWins, inp.sampleWins + inp.sampleLosses) : null
  })
  const percentileNow = computed(() => (currentScore.value === null ? null : populationPercentile(currentScore.value)))
  const percentileTarget = computed(() => (targetScore.value === null ? null : populationPercentile(targetScore.value)))

  const weeksNaive = computed(() => gamesToWeeks(naive.value?.expectedGames ?? null, gamesPerWeekInput.value))
  const weeksDecay = computed(() => gamesToWeeks(decay.value?.expectedGames ?? null, gamesPerWeekInput.value))

  const seasonGames = computed(() => {
    const pace = gamesPerWeekInput.value
    return pace === null || pace <= 0 ? null : Math.round(pace * SEASON_WEEKS)
  })
  const probThisSeason = computed(() => {
    if (projInput.value === null || seasonGames.value === null) return null
    return probWithinGames(projInput.value, seasonGames.value)
  })
  const requiredWrForSeason = computed(() => {
    if (projInput.value === null || seasonGames.value === null) return null
    return requiredWinRateForGames(projInput.value, seasonGames.value)
  })

  // Odds of a STREAK_LEN-loss run in the next STREAK_HORIZON games at the
  // current win rate — the anti-"rigged" reality check.
  const lossStreak = computed(() => {
    const rate = effectiveWinRatePct.value
    if (rate === null || sampleN.value <= 0) return null
    return lossStreakChance(rate / 100, STREAK_LEN, STREAK_HORIZON)
  })

  // ── The Bayesian layer (skeptic prior — see elo-bayes) ─────────────
  // All four follow the editable sample, so a manual what-if updates them
  // like every other derived stat.
  const skepticVerdict = computed(() => {
    const inp = projInput.value
    return inp ? probTrueWinRateAbove(0.5, inp.sampleWins, inp.sampleLosses) : null
  })
  const trueRateRange = computed(() => {
    const inp = projInput.value
    return inp ? credibleInterval(inp.sampleWins, inp.sampleLosses) : null
  })
  const climbQuantiles = computed(() => (projInput.value ? posteriorClimbQuantiles(projInput.value) : null))
  const gamesToCertainty = computed(() => {
    const inp = projInput.value
    return inp ? gamesToKnow(inp.sampleWins, inp.sampleLosses, KNOW_HALF_WIDTH) : null
  })

  // History-derived stats: the actual played sequence — a what-if can't
  // rewrite what already happened.
  const runs = computed(() => runsTest(decisiveResults(trackRecs.value)))

  // ── Phase 2: the bootstrap season simulator + the Kalman skill curve ──
  // The sim follows the FORM (posterior sample + target + pace) but replays
  // the player's real rank-card moves; a manual meter edit only matters as
  // the fallback when the empirical pools are thin.
  const meterSamples = computed(() => meterMoveSamples(trackRecs.value))
  const seasonSim = computed<SeasonSim | null>(() => {
    const inp = projInput.value
    const horizon = seasonGames.value
    if (!inp || horizon === null || inp.targetScore <= inp.currentScore) return null
    return simulateSeasons({
      currentScore: inp.currentScore,
      targetScore: inp.targetScore,
      sampleWins: inp.sampleWins,
      sampleLosses: inp.sampleLosses,
      horizonGames: horizon,
      meter: meterSamples.value,
      symmetricFallbackPct: inp.meterMovePct,
    })
  })
  // The skill curve is pure history: the track's rank readings, de-noised.
  const skillCurve = computed<SkillCurve | null>(() => {
    const points = rankLadderSeries(trackRecs.value)[0]?.points ?? []
    return computeSkillCurve(points)
  })

  // Phase 3: the dated win-rate break (with what changed around it) and
  // the ranked lift table — both pure history over the track.
  const changePoint = computed<{ point: ChangePoint; context: ChangePointContext } | null>(() => {
    const point = detectChangePoint(decisiveTimeline(trackRecs.value))
    if (point === null) return null
    return { point, context: changePointContext(trackRecs.value, point.t, opts.heroRole) }
  })
  const lift = computed<LiftRow[]>(() =>
    liftTable(trackRecs.value, { heroRole: opts.heroRole, mapGameMode: opts.mapGameMode }))
  // The best-vs-worst hero spread, priced in the player's own meter — how
  // much faster the climb goes on the right heroes.
  const heroGap = computed<HeroGap | null>(() =>
    heroClimbGap(heroStats.value, meterSamples.value, meterMovePct.value))

  return {
    // track picking
    track, tracks: computed(() => tracksInfo.value.tracks), setTrack, trackLabels: TRACK_LABELS,
    // editable inputs + edit API
    currentTier, currentDivision, currentProgress, targetTier, targetDivision,
    winRatePct, sampleN, meterMovePct, gamesPerWeekInput, decaySlopePts,
    editInput, lastSeed,
    // hero picker + what-if nudges
    heroStats, selectedHeroes, toggleHero,
    heroAdjustPts, bumpHero, resetHeroAdjust, whatIf, effectiveWinRatePct,
    // derived
    trackRecs, currentScore, targetScore, projInput, naive, decay, curves,
    pValue, percentileNow, percentileTarget, weeksNaive, weeksDecay,
    seasonGames, probThisSeason, requiredWrForSeason,
    lossStreak, streakLen: STREAK_LEN, streakHorizon: STREAK_HORIZON,
    skepticVerdict, trueRateRange, climbQuantiles, gamesToCertainty,
    runs, seasonSim, skillCurve, changePoint, lift, heroGap,
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10
}

export type EloCalculator = ReturnType<typeof useEloCalculator>

const ELO_CALC_KEY: InjectionKey<EloCalculator> = Symbol('recall.elo-calculator')

// useEloCalc injects the calculator provided by EloCalculatorView —
// throws loudly when a component is mounted outside the provider.
export function useEloCalc(): EloCalculator {
  const calc = inject(ELO_CALC_KEY)
  if (!calc) {
    throw new Error('useEloCalc() called outside an EloCalculatorView provider.')
  }
  return calc
}

export function provideEloCalculator(calc: EloCalculator): void {
  provide(ELO_CALC_KEY, calc)
}

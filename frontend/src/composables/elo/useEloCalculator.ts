import {
  computed, inject, provide, ref, toValue, watch,
  type ComputedRef, type InjectionKey, type MaybeRefOrGetter, type Ref,
} from 'vue'
import type { MatchRecord } from '@/api-client'
import { TIER_ORDER, ladderScore, rankLadderSeries, type Tier } from '@/match/match-trends-helpers'
import {
  availableTracks, heroPickerStats, pooledDecisiveMatches, pooledWinLoss, seedTrack, trackRecords,
  TRACK_LABELS, type HeroPickStat, type TrackKey, type TrackSeed,
} from '@/match/elo-seed'
import {
  decayProjection, gamesToWeeks, naiveProjection, projectionCurves,
  requiredWinRateForGames, DEFAULT_DECAY_SLOPE, DEFAULT_METER_MOVE_PCT,
  PROVISIONAL_MIN_DECISIVE,
  type DecayProjection, type NaiveProjection, type ProjectionCurves, type ProjectionInput,
} from '@/match/elo-model'
import { binomialTwoSidedP, lossStreakChance, runsTest } from '@/match/elo-stats'
import {
  ceilingRange, credibleInterval, gamesToKnow, probTrueWinRateAbove,
  type CeilingRange, type SlopeCI,
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

// SeededForm is the snapshot of what the seed wrote into the form — the
// "measured" baseline every edited-state affordance compares against.
interface SeededForm {
  currentTier: Tier
  currentDivision: number
  currentProgress: number
  targetTier: Tier
  targetDivision: number
  winRatePct: number | null
  sampleN: number
  meterMovePct: number
  gamesPerWeekInput: number | null
  decaySlopePts: number
}

// The all-clean marker set — what editedFields reports before a seed
// has ever been applied (nothing to compare against yet).
const NO_EDITED_FIELDS: Record<keyof SeededForm, boolean> = {
  currentTier: false,
  currentDivision: false,
  currentProgress: false,
  targetTier: false,
  targetDivision: false,
  winRatePct: false,
  sampleN: false,
  meterMovePct: false,
  gamesPerWeekInput: false,
  decaySlopePts: false,
}

// SEASON_WEEKS sizes the "this season" probability window.
const SEASON_WEEKS = 12
// With no measured pace the simulator assumes a typical week so the verdict
// still has a season to quote; paceAssumed flags the copy.
const FALLBACK_GAMES_PER_WEEK = 10
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
  // The exact post-rounding form values the seed wrote — the "measured"
  // baseline that edited-field markers and the delta strip compare against.
  const seededForm = ref<SeededForm | null>(null)

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
    seededForm.value = {
      currentTier: currentTier.value,
      currentDivision: currentDivision.value,
      currentProgress: currentProgress.value,
      targetTier: targetTier.value,
      targetDivision: targetDivision.value,
      winRatePct: winRatePct.value,
      sampleN: sampleN.value,
      meterMovePct: meterMovePct.value,
      gamesPerWeekInput: gamesPerWeekInput.value,
      decaySlopePts: decaySlopePts.value,
    }
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

  // selectAllHeroes / clearHeroSelection back the picker's bulk buttons.
  // Both count as edits (dirty) exactly like a per-hero toggle.
  function selectAllHeroes(): void {
    const next: ReadonlySet<string> = new Set(heroStats.value.map((h) => h.key))
    selectedHeroes.value = next
    dirty.value = true
    applyHeroSelection(next)
  }

  function clearHeroSelection(): void {
    const next: ReadonlySet<string> = new Set()
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
    // Per-hero rates pool by credit, but evidence pools by MATCH: a game
    // meaningfully played on two selected heroes is one game, not two.
    sampleN.value = Math.min(wins + losses, pooledDecisiveMatches(trackRecs.value, selection))
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

  // ── Edited state: what differs from the measured seed ──────────────
  // Per-field markers + the one flag the verdict eyebrow and the delta
  // strip key on. Hero selection and nudges count as edits too.
  const editedFields = computed<Record<keyof SeededForm, boolean>>(() => {
    const f = seededForm.value
    if (f === null) return NO_EDITED_FIELDS
    return {
      currentTier: currentTier.value !== f.currentTier,
      currentDivision: currentDivision.value !== f.currentDivision,
      currentProgress: currentProgress.value !== f.currentProgress,
      targetTier: targetTier.value !== f.targetTier,
      targetDivision: targetDivision.value !== f.targetDivision,
      winRatePct: winRatePct.value !== f.winRatePct,
      sampleN: sampleN.value !== f.sampleN,
      meterMovePct: meterMovePct.value !== f.meterMovePct,
      gamesPerWeekInput: gamesPerWeekInput.value !== f.gamesPerWeekInput,
      decaySlopePts: decaySlopePts.value !== f.decaySlopePts,
    }
  })
  const isEdited = computed(() =>
    Object.values(editedFields.value).some(Boolean)
    || selectedHeroes.value.size > 0
    || heroAdjustPts.value.size > 0)

  // resetToMeasured re-seeds the whole form (and clears the hero
  // selection + nudges) — the one way back to the measured numbers.
  const resetToMeasured = applySeed

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

  // The meter's break-even rate: where the player's REAL pools zero the
  // drift (|L̄|/(W̄+|L̄|)). The simulator equilibrates there automatically;
  // the closed forms must share it or the verdict plateaus in a different
  // place than the seasons it quotes. Symmetric 0.5 until both pools are
  // deep enough to trust (the sim's own MIN_POOL rule).
  const plateauRate = computed<number>(() => {
    const { winMoves, lossMoves } = meterSamples.value
    if (winMoves.length < 8 || lossMoves.length < 8) return 0.5
    const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length
    const w = mean(winMoves)
    const l = Math.abs(mean(lossMoves))
    return w + l > 0 ? l / (w + l) : 0.5
  })

  const projInput = computed<ProjectionInput | null>(() => {
    if (currentScore.value === null || targetScore.value === null) return null
    const rate = effectiveWinRatePct.value
    const measured = winRatePct.value
    if (rate === null || measured === null || sampleN.value <= 0 || meterMovePct.value <= 0) return null
    // The sample counts come from the MEASURED (or manually edited) rate —
    // never the hero-nudged one. A nudge is a hypothesis about future games;
    // baking it into sampleWins forged evidence and moved the p-value, the
    // posterior, and every interval toward games never played. winRate stays
    // the dialed rate so projections follow the what-if.
    const wins = Math.round((sampleN.value * measured) / 100)
    return {
      currentScore: currentScore.value,
      targetScore: targetScore.value,
      winRate: rate / 100,
      sampleWins: wins,
      sampleLosses: sampleN.value - wins,
      meterMovePct: meterMovePct.value,
      decaySlope: decaySlopePts.value / 100,
      plateauRate: plateauRate.value,
    }
  })

  // The ceiling as a credible RANGE: win-rate posterior × measured slope CI
  // through the plateau identity. The slope CI drops out when the user
  // overrides the dial (a chosen slope has no sampling uncertainty).
  const measuredSlopeCI = computed<SlopeCI | null>(() => {
    if (editedFields.value.decaySlopePts) return null
    const m = lastSeed.value?.decaySlope ?? null
    return m === null ? null : { lowerPts: m.lowerPts, upperPts: m.upperPts }
  })
  const ceiling = computed<CeilingRange | null>(() =>
    (projInput.value ? ceilingRange(projInput.value, measuredSlopeCI.value) : null))
  // Below the floor the verdict hedges and the cards disclose the prior.
  const provisional = computed(() => sampleN.value > 0 && sampleN.value < PROVISIONAL_MIN_DECISIVE)

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
  // The season probability IS the simulator's reach share — one model for
  // every number on the page (the old IG first-passage layer ignored decay
  // and contradicted the verdict by construction).
  const probThisSeason = computed(() => seasonSim.value?.probReachTarget ?? null)
  const requiredWrForSeason = computed(() => {
    if (projInput.value === null || seasonGames.value === null) return null
    return requiredWinRateForGames(projInput.value, seasonGames.value)
  })

  // ── The measured baseline, projected (feeds the delta strip) ───────
  const measuredProjInput = computed<ProjectionInput | null>(() => {
    const f = seededForm.value
    if (f === null || f.winRatePct === null || f.sampleN <= 0 || f.meterMovePct <= 0) return null
    const cur = ladderScore(f.currentTier, f.currentDivision, f.currentProgress)
    const tgt = ladderScore(f.targetTier, f.targetDivision, 0)
    if (cur === null || tgt === null) return null
    const wins = Math.round((f.sampleN * f.winRatePct) / 100)
    return {
      currentScore: cur,
      targetScore: tgt,
      winRate: f.winRatePct / 100,
      sampleWins: wins,
      sampleLosses: f.sampleN - wins,
      meterMovePct: f.meterMovePct,
      decaySlope: f.decaySlopePts / 100,
      plateauRate: plateauRate.value,
    }
  })
  const measuredNaive = computed<NaiveProjection | null>(() =>
    (measuredProjInput.value ? naiveProjection(measuredProjInput.value) : null))
  const measuredWeeks = computed(() =>
    gamesToWeeks(measuredNaive.value?.expectedGames ?? null, seededForm.value?.gamesPerWeekInput ?? null))
  // The measured baseline runs the SAME simulator (recomputes only on
  // re-seed), so the delta strip prices edits against comparable odds.
  const measuredSeasonSim = computed<SeasonSim | null>(() => {
    const inp = measuredProjInput.value
    const f = seededForm.value
    if (!inp || inp.targetScore <= inp.currentScore) return null
    const pace = f?.gamesPerWeekInput ?? null
    const horizon = pace !== null && pace > 0 ? Math.round(pace * SEASON_WEEKS) : FALLBACK_GAMES_PER_WEEK * SEASON_WEEKS
    return simulateSeasons({
      currentScore: inp.currentScore,
      targetScore: inp.targetScore,
      sampleWins: inp.sampleWins,
      sampleLosses: inp.sampleLosses,
      horizonGames: horizon,
      meter: meterSamples.value,
      symmetricFallbackPct: inp.meterMovePct,
      decaySlope: inp.decaySlope,
    })
  })
  const measuredProbSeason = computed(() => measuredSeasonSim.value?.probReachTarget ?? null)

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
  // the fallback when the empirical pools are thin. It carries the decay
  // slope too — the ONE model every probability on the page derives from —
  // and, with no measured pace, assumes a typical week so the verdict is
  // still quotable (paceAssumed flags the copy).
  const meterSamples = computed(() => meterMoveSamples(trackRecs.value))
  const paceAssumed = computed(() => seasonGames.value === null)
  const simHorizonGames = computed(() => seasonGames.value ?? FALLBACK_GAMES_PER_WEEK * SEASON_WEEKS)
  const seasonSim = computed<SeasonSim | null>(() => {
    const inp = projInput.value
    if (!inp || inp.targetScore <= inp.currentScore) return null
    const measured = winRatePct.value
    return simulateSeasons({
      currentScore: inp.currentScore,
      targetScore: inp.targetScore,
      sampleWins: inp.sampleWins,
      sampleLosses: inp.sampleLosses,
      horizonGames: simHorizonGames.value,
      meter: meterSamples.value,
      symmetricFallbackPct: inp.meterMovePct,
      decaySlope: inp.decaySlope,
      // The hero what-if enters as a location shift on the drawn form —
      // the posterior keeps the real sample's width.
      rateShiftPts: measured === null ? 0 : (effectiveWinRatePct.value ?? measured) - measured,
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
    editInput, lastSeed, editedFields, isEdited, resetToMeasured,
    measuredNaive, measuredWeeks, measuredProbSeason,
    // hero picker + what-if nudges
    heroStats, selectedHeroes, toggleHero, selectAllHeroes, clearHeroSelection,
    heroAdjustPts, bumpHero, resetHeroAdjust, whatIf, effectiveWinRatePct,
    // derived
    trackRecs, currentScore, targetScore, projInput, naive, decay, curves,
    ceiling, provisional,
    pValue, percentileNow, percentileTarget, weeksNaive, weeksDecay,
    seasonGames, simHorizonGames, paceAssumed, probThisSeason, requiredWrForSeason,
    lossStreak, streakLen: STREAK_LEN, streakHorizon: STREAK_HORIZON,
    skepticVerdict, trueRateRange, gamesToCertainty,
    runs, seasonSim, measuredSeasonSim, skillCurve, changePoint, lift, heroGap,
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

import {
  computed, inject, onScopeDispose, provide, ref, toValue, watch,
  type ComputedRef, type InjectionKey, type MaybeRefOrGetter, type Ref,
} from 'vue'
import { usePersistedRef } from '@/composables/shared/usePersistedRef'
import type { MatchRecord } from '@/api-client'
import type { Season } from '@/composables/shared/useOWData'
import { seasonForMatch } from '@/match/match-season-helpers'
import { TIER_ORDER, ladderScore, rankLadderSeries, type Tier } from '@/match/trends/match-trends-helpers'
import {
  availableTracks, heroPickerStats, pooledDecisiveMatches, pooledWinLoss, seedTrack, trackRecords,
  TRACK_LABELS, type HeroPickStat, type TrackKey, type TrackSeed,
} from '@/match/elo/elo-seed'
import {
  decayProjection, gamesToWeeks, naiveProjection, projectionCurves,
  requiredWinRateForGames, DEFAULT_DECAY_SLOPE, DEFAULT_METER_MOVE_PCT,
  PROVISIONAL_MIN_DECISIVE,
  type DecayProjection, type GoalPace, type NaiveProjection, type ProjectionCurves, type ProjectionInput,
} from '@/match/elo/elo-model'
import { binomialTwoSidedP, lossStreakChance, runsTest } from '@/match/elo/elo-stats'
import {
  NO_EDITED_FIELDS, diffSeededForm, plateauRateFromMeter, projectionInputFromForm,
  round1, seasonSimFromProjection, type EloFormSnapshot,
} from '@/match/elo/elo-form'
import {
  ceilingRange, credibleInterval, gamesToKnow, probTrueWinRateAbove,
  type CeilingRange, type SlopeCI,
} from '@/match/elo/elo-bayes'
import { decisiveResults, decisiveTimeline } from '@/match/elo/elo-streaks'
import { meterMoveSamples, type SeasonSim } from '@/match/elo/elo-simulate'
import { skillCurve as computeSkillCurve, type SkillCurve } from '@/match/elo/elo-kalman'
import {
  changePointContext, detectChangePoint, type ChangePoint, type ChangePointContext,
} from '@/match/elo/elo-changepoint'
import { liftTable, type LiftRow } from '@/match/elo/elo-lift'
import { clampHeroAdjust, heroWhatIf, type HeroWhatIf } from '@/match/elo/elo-whatif'
import { heroClimbGap, type HeroGap } from '@/match/elo/elo-hero-gap'

// The Elo Calculator's single state owner (loan-calculator semantics):
// picking a track re-fills every input from that track's history; every
// input stays editable; a manual edit stops background re-seeding so
// the user's numbers never fight the data. Provided to the elo/*
// components via inject, mirroring the dashboard's useDossier seam.

export interface EloCalcOpts {
  records: MaybeRefOrGetter<MatchRecord[]>
  heroRole: (hero: string | null | undefined) => string
  mapGameMode: (map: string | null | undefined) => string
  // Needed to pair two percentile readings honestly: a Rank Redistribution
  // moves the whole population, so readings either side of a season boundary
  // measure different ladders and their difference is not a climb.
  seasons: MaybeRefOrGetter<Season[]>
}

// SEASON_WEEKS sizes the "this season" probability window.
const SEASON_WEEKS = 12
const MS_PER_WEEK = 7 * 86_400_000
// How often the deadline readout re-reads the wall clock. Coarse on purpose:
// the sentence is measured in weeks, so a minute of staleness is invisible and
// a tighter interval would wake the app for nothing.
const CLOCK_TICK_MS = 60_000
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
  // The GOAL persists; everything else on this tab is a what-if you dial in
  // and throw away. "Reach Diamond by the end of the season" is a thing a
  // player decides once and then comes back to — losing it on reload made the
  // tab a calculator rather than something you can be held to.
  //
  // Stored as the player's PICK, empty until they make one, with the
  // one-tier-up default DERIVED rather than assigned. The seed re-runs
  // whenever the corpus changes, so a default written into the same ref
  // would overwrite the saved goal on every launch — and did.
  const { value: pickedTier, set: setTargetTier } = usePersistedRef<Tier | ''>({
    key: 'recall.elo.targetTier',
    defaultValue: '',
    parse: (raw) => (TIER_ORDER.includes(raw as Tier) ? (raw as Tier) : undefined),
  })
  const { value: pickedDivision, set: setTargetDivision } = usePersistedRef<number>({
    key: 'recall.elo.targetDivision',
    defaultValue: 0,
    // REJECTS out of range rather than clamping, because 0 is how this ref
    // says "no pick" — a clamp would turn the reset's 0 into a 1 the moment a
    // sibling instance re-hydrated, and would have turned a stored 9 into a
    // legitimate-looking 5.
    parse: (raw) => {
      const n = Number(raw)
      return Number.isInteger(n) && n >= 1 && n <= 5 ? n : undefined
    },
  })
  // The deadline the goal is measured against. Empty means "no date, just get
  // there" — a goal without one is still a goal, and forcing a date would make
  // the field a guess rather than a commitment.
  const { value: targetBy, set: setTargetBy } = usePersistedRef<string>({
    key: 'recall.elo.targetBy',
    defaultValue: '',
    parse: (raw) => (raw === '' || !Number.isNaN(Date.parse(raw)) ? raw : undefined),
  })
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
  const seededForm = ref<EloFormSnapshot | null>(null)

  const seed = computed(() => seedTrack(
    records.value, track.value,
    (rec) => seasonForMatch(rec, toValue(opts.seasons))?.name ?? null,
  ))

  // The live form values as one plain snapshot — the shape the pure
  // elo-form assembly + diff helpers consume. Reading the refs inside
  // a computed keeps the dependency tracking intact.
  function formSnapshot(): EloFormSnapshot {
    return {
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

  function applySeed(): void {
    const s = seed.value
    lastSeed.value = s
    if (s.rank) {
      currentTier.value = s.rank.tier
      currentDivision.value = s.rank.level
      // Same rule as the seed: the picker needs a number, and the bottom of the
      // known division is where an unread progress starts.
      currentProgress.value = Math.max(0, s.rank.progress ?? 0)
    }
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
    // The baseline target is the DERIVED default, never a saved goal —
    // otherwise a goal carried over from a past session would read as a
    // measured number and its edited marker would never light.
    seededForm.value = {
      ...formSnapshot(),
      targetTier: defaultTarget.value.tier,
      targetDivision: defaultTarget.value.division,
    }
  }

  // Default goal: one tier up, division 5 (Champion tops out at 1). Derived
  // from wherever the player currently sits, so switching tracks moves it
  // without touching — or losing — a goal they actually set.
  const defaultTarget = computed<{ tier: Tier; division: number }>(() => {
    const idx = (TIER_ORDER as readonly string[]).indexOf(currentTier.value)
    const next = Math.min(idx + 1, TIER_ORDER.length - 1)
    return { tier: TIER_ORDER[next] ?? 'champion', division: next === idx ? 1 : 5 }
  })
  const targetTier = computed<Tier>(() => pickedTier.value || defaultTarget.value.tier)
  const targetDivision = computed<number>(() => pickedDivision.value || defaultTarget.value.division)

  // A goal edit is an edit like any other: it must stop the corpus watcher
  // from re-seeding over the form the player is working in.
  function pickTargetTier(next: Tier): void { setTargetTier(next); dirty.value = true }
  function pickTargetDivision(next: number): void { setTargetDivision(next); dirty.value = true }
  function pickTargetBy(next: string): void { setTargetBy(next); dirty.value = true }

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
  const editedFields = computed<Record<keyof EloFormSnapshot, boolean>>(() => {
    const f = seededForm.value
    return f === null ? NO_EDITED_FIELDS : diffSeededForm(f, formSnapshot())
  })
  // Any edit to the measured POSITION invalidates a measured standing: the
  // percentile was printed against the rank the screenshot showed, and a
  // hypothetical rank has no measurement. Progress counts — the rank screen
  // prints "RANK PROGRESS: 67%" and the percentile caption on the SAME row, and
  // dragging 67 to 5 is a division's worth of ladder movement.
  const rankInputsEdited = computed(() =>
    editedFields.value.currentTier
    || editedFields.value.currentDivision
    || editedFields.value.currentProgress)

  // The season-4 population reading for the MEASURED rank — "higher ranked than
  // N% of players", straight off the rank screen rather than modeled from a
  // distribution. null also covers every reading from before season 4, which
  // carried no caption.
  //
  // lastSeed, NOT seed. The tier/division inputs are a SNAPSHOT frozen at the
  // last applySeed(), and `watch(seed, …)` suppresses re-seeding while the form
  // is dirty. Reading the live seed therefore drifted from what the panel
  // displays: edit any unrelated input, let the folder watcher parse a newer
  // rank screenshot, and the selects still read the old rank while the
  // percentile jumped to the new one — a number measured against a rank the
  // panel is not showing. measuredSlopeCI below reads lastSeed for the same
  // reason, and so does percentileTrail.
  const measuredPercentile = computed<number | null>(() =>
    rankInputsEdited.value ? null : lastSeed.value?.rank?.percentile ?? null)

  // Where that standing has BEEN — the only honest successor to the population
  // card deleted in a928122f, which needed a published distribution that
  // season 4's redistribution voided. This needs none: it compares the player
  // against themselves.
  const percentileTrail = computed(() =>
    rankInputsEdited.value ? null : lastSeed.value?.percentileTrail ?? null)

  const isEdited = computed(() =>
    Object.values(editedFields.value).some(Boolean)
    || selectedHeroes.value.size > 0
    || heroAdjustPts.value.size > 0)

  // resetToMeasured re-seeds the whole form (and clears the hero
  // selection + nudges) — the one way back to the measured numbers.
  //
  // That includes the GOAL. The pick lives in localStorage and the derived
  // default is what the form seeds to, so without clearing it here a goal
  // could be set but never unset: the edited marker stayed lit forever and
  // the target stopped following the player's rank.
  function resetToMeasured(): void {
    setTargetTier('')
    setTargetDivision(0)
    setTargetBy('')
    applySeed()
  }

  // Manual edits are name-keyed (templates auto-unwrap destructured refs,
  // so they can't pass the ref itself). Every edit marks the form dirty;
  // win-rate/sample edits also detach the hero selection so the two
  // sources never fight.
  // Only the throwaway what-if inputs. The goal is written through its own
  // setters — assigning its ref would update the form and silently skip the
  // persist, which is what a bare entry here used to do.
  const editable = {
    currentTier, currentDivision, currentProgress,
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

  // The meter's break-even rate — see plateauRateFromMeter for why the
  // closed forms must share the simulator's equilibrium.
  const plateauRate = computed<number>(() => plateauRateFromMeter(meterSamples.value))

  // Sample counts follow the MEASURED rate; winRate follows the dialed
  // (hero-nudged) one — the split lives in projectionInputFromForm.
  const projInput = computed<ProjectionInput | null>(() =>
    projectionInputFromForm(formSnapshot(), plateauRate.value, effectiveWinRatePct.value))

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

  // "Weeks left" is the only number on this tab read off the wall clock, and a
  // computed is evaluated once and memoized — so in a tray app left running,
  // "1.9 weeks left" stayed on screen after the date had gone. The tick is the
  // dependency that lets the sentence age.
  const clockTick = ref(Date.now())
  const clockTimer = window.setInterval(() => { clockTick.value = Date.now() }, CLOCK_TICK_MS)
  onScopeDispose(() => { window.clearInterval(clockTimer) })

  /**
   * Whether the goal lands by its date, at the pace already measured.
   *
   * The model counts GAMES, and a player commits to a DATE — so this is the
   * one place the two meet, and it needs the games-per-week the player is
   * actually playing rather than an assumption. Null only when there is no
   * date to measure against; every other gap gets a named arm, because "out
   * of reach" and "nothing to project from" are different answers.
   */
  const goalPace = computed<GoalPace | null>(() => {
    if (!targetBy.value) return null
    const by = Date.parse(targetBy.value)
    if (Number.isNaN(by)) return null
    const weeksLeft = round1((by - clockTick.value) / MS_PER_WEEK)
    const pace = gamesPerWeekInput.value
    if (pace === null || pace <= 0) return { kind: 'no-pace', weeksLeft }
    // No projection at all — no decisive sample, no meter move, no ladder
    // score — is not the same as a goal past where the climb plateaus, and
    // saying "out of reach" on the strength of no data is the exact mistake
    // the results panel already carries a regression test for.
    if (projInput.value === null) return { kind: 'no-projection', weeksLeft }
    const weeks = weeksDecay.value
    if (weeks === null) return { kind: 'unreachable', weeksLeft }
    return { kind: 'measured', weeksLeft, weeksNeeded: round1(weeks), onPace: weeks <= weeksLeft }
  })

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
    return f === null ? null : projectionInputFromForm(f, plateauRate.value)
  })
  const measuredNaive = computed<NaiveProjection | null>(() =>
    (measuredProjInput.value ? naiveProjection(measuredProjInput.value) : null))
  const measuredWeeks = computed(() =>
    gamesToWeeks(measuredNaive.value?.expectedGames ?? null, seededForm.value?.gamesPerWeekInput ?? null))
  // The measured baseline runs the SAME simulator (recomputes only on
  // re-seed), so the delta strip prices edits against comparable odds.
  const measuredSeasonSim = computed<SeasonSim | null>(() => {
    const inp = measuredProjInput.value
    if (!inp) return null
    const pace = seededForm.value?.gamesPerWeekInput ?? null
    const horizon = pace !== null && pace > 0 ? Math.round(pace * SEASON_WEEKS) : FALLBACK_GAMES_PER_WEEK * SEASON_WEEKS
    return seasonSimFromProjection(inp, horizon, meterSamples.value)
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
    if (!inp) return null
    const measured = winRatePct.value
    // The hero what-if enters as a location shift on the drawn form —
    // the posterior keeps the real sample's width.
    const shift = measured === null ? 0 : (effectiveWinRatePct.value ?? measured) - measured
    return seasonSimFromProjection(inp, simHorizonGames.value, meterSamples.value, shift)
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
    pickTargetTier, pickTargetDivision, targetBy, pickTargetBy,
    winRatePct, sampleN, meterMovePct, gamesPerWeekInput, decaySlopePts,
    editInput, lastSeed, editedFields, isEdited, resetToMeasured, measuredPercentile, percentileTrail,
    measuredNaive, measuredWeeks, measuredProbSeason,
    // hero picker + what-if nudges
    heroStats, selectedHeroes, toggleHero, selectAllHeroes, clearHeroSelection,
    heroAdjustPts, bumpHero, resetHeroAdjust, whatIf, effectiveWinRatePct,
    // derived
    trackRecs, currentScore, targetScore, projInput, naive, decay, curves,
    ceiling, provisional,
    pValue, weeksNaive, weeksDecay, goalPace,
    seasonGames, simHorizonGames, paceAssumed, probThisSeason, requiredWrForSeason,
    lossStreak, streakLen: STREAK_LEN, streakHorizon: STREAK_HORIZON,
    skepticVerdict, trueRateRange, gamesToCertainty,
    runs, seasonSim, measuredSeasonSim, skillCurve, changePoint, lift, heroGap,
  }
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

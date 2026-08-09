// The Elo Calculator's two projection models over the rank ladder
// (ladderScore units: 1.0 = one division, 5 = one tier, 0..40 = the
// whole ladder).
//
//   NAIVE — the win rate never changes: a biased random walk whose step
//   is the per-game meter move. Loan-calculator math: games = distance
//   over drift, with an honest CI from the win-rate sample (Wilson) and
//   the walk's own luck spread (first-passage / inverse Gaussian).
//
//   ELO DECAY — matchmaking pushes the win rate toward 50% as you
//   approach the rank your current form implies ("where you belong").
//   The climb decelerates exponentially and plateaus at that implied
//   true rank; targets beyond it are unreachable without improvement.
//
// Draws (~1%) are excluded everywhere: "games" always means decisive.

import { wilsonInterval } from '@/match/match-sample-helpers'
import { inverseGaussianCdf } from '@/match/elo-stats'

// DEFAULT_METER_MOVE_PCT is the fallback per-game rank-meter move
// (progress-%) when a track has too few rank readings to measure it.
export const DEFAULT_METER_MOVE_PCT = 21
// DEFAULT_DECAY_SLOPE is how fast the win rate regresses per division
// climbed (WR fraction per division): 1.5 points/division.
export const DEFAULT_DECAY_SLOPE = 0.015
// LADDER_MAX is Champion 1 @ 100% in ladderScore units.
export const LADDER_MAX = 40

// Below this many decisive games the verdict is an "Early read": the win
// rate barely constrains the ceiling (a 1W-2L record once printed "Capped
// near Bronze 5 — Reality check" with full confidence), so the page hedges,
// shows the ceiling as a range, and never says Capped.
export const PROVISIONAL_MIN_DECISIVE = 20

export interface ProjectionInput {
  currentScore: number
  targetScore: number
  winRate: number // decisive fraction 0..1 (the editable input)
  sampleWins: number // the sample behind winRate — drives Wilson + p-value
  sampleLosses: number
  meterMovePct: number // m: progress-% the meter moves per decisive game
  decaySlope: number // s: WR fraction lost per division climbed
  // The break-even win rate where the meter's drift zeroes. 0.5 for a
  // symmetric ±m meter; with the player's REAL pools it is |L̄|/(W̄+|L̄|)
  // (win moves averaging +15 vs losses −25 break even at 62.5%). The
  // simulator's equilibrium falls out of its pools automatically — these
  // closed forms must use the SAME break-even or the verdict and the
  // season cards plateau in different places and contradict each other.
  plateauRate?: number
}

function breakEven(input: ProjectionInput): number {
  return input.plateauRate ?? 0.5
}

// GamesRange is a 95% CI on the games count; a null upper bound means
// "cannot rule out never reaching the target" (the Wilson interval on
// the win rate reaches the no-drift point).
export interface GamesRange {
  lower: number | null
  upper: number | null
}

export interface NaiveProjection {
  reachable: boolean
  expectedGames: number | null // 0 when already there; null when unreachable
  games95: GamesRange
  walkStdGames: number | null // ±1σ of pure luck at exactly this win rate
  driftPerGame: number // ladder units per game (signed)
}

// naiveGamesAt is E[games] to cover distance D at win rate p with step
// s_m — null when the drift is zero or points away from the target.
// Drift = 2·s_m·(p − p*): identical to s_m·(2p−1) at the symmetric
// break-even, shifted when the meter pools are asymmetric.
function naiveGamesAt(distance: number, stepUnits: number, p: number, pStar: number): number | null {
  const drift = 2 * stepUnits * (p - pStar)
  if (distance === 0) return 0
  if (drift === 0 || distance * drift < 0) return null
  return distance / drift
}

// wilsonGamesRange propagates the win-rate sample's Wilson 95% interval
// through a games-at-p function: the CI's fast side uses the favourable
// bound, the slow side the unfavourable one (null = unreachable there).
// When input.winRate departs from the sample rate (a manual edit or hero
// nudge), the interval recenters on the dialed rate at the REAL sample's
// width — the dial moves the projection, it never fakes a sample.
function wilsonGamesRange(
  input: ProjectionInput,
  gamesAt: (p: number) => number | null,
): GamesRange {
  const n = input.sampleWins + input.sampleLosses
  const iv = wilsonInterval(input.sampleWins, n)
  if (iv === null) return { lower: null, upper: null }
  const delta = n > 0 ? input.winRate - input.sampleWins / n : 0
  const clamp01 = (p: number): number => Math.min(1, Math.max(0, p))
  const candidates = [gamesAt(clamp01(iv.lower + delta)), gamesAt(clamp01(iv.upper + delta))]
  const finite = candidates.filter((g): g is number => g !== null)
  if (finite.length === 0) return { lower: null, upper: null }
  const lower = Math.min(...finite)
  return { lower, upper: finite.length === 2 ? Math.max(...finite) : null }
}

export function naiveProjection(input: ProjectionInput): NaiveProjection {
  const stepUnits = input.meterMovePct / 100
  const distance = input.targetScore - input.currentScore
  const pStar = breakEven(input)
  const drift = 2 * stepUnits * (input.winRate - pStar)
  const expected = naiveGamesAt(distance, stepUnits, input.winRate, pStar)
  return {
    reachable: expected !== null,
    expectedGames: expected,
    games95: wilsonGamesRange(input, (p) => naiveGamesAt(distance, stepUnits, p, pStar)),
    walkStdGames: naiveWalkStd(distance, stepUnits, input.winRate, drift),
    driftPerGame: drift,
  }
}

// naiveWalkStd is the first-passage-time standard deviation given the
// win rate is EXACTLY p: √(D·σ²/δ³) with σ² = s_m²·4p(1−p).
function naiveWalkStd(distance: number, stepUnits: number, p: number, drift: number): number | null {
  if (distance === 0 || drift === 0 || distance * drift < 0) return null
  const sigma2 = stepUnits * stepUnits * 4 * p * (1 - p)
  return Math.sqrt((distance * sigma2) / (drift * drift * drift))
}

// probWithinGames is P(the naive walk reaches the target within `games`
// decisive games): the inverse-Gaussian first-passage CDF. Null when
// the target is unreachable at this win rate; 1 when already there.
export function probWithinGames(input: ProjectionInput, games: number): number | null {
  const stepUnits = input.meterMovePct / 100
  const distance = input.targetScore - input.currentScore
  if (distance === 0) return 1
  const expected = naiveGamesAt(distance, stepUnits, input.winRate, breakEven(input))
  if (expected === null) return null
  const sigma2 = stepUnits * stepUnits * 4 * input.winRate * (1 - input.winRate)
  if (sigma2 === 0) return games >= expected ? 1 : 0
  const lambda = (distance * distance) / sigma2
  return inverseGaussianCdf(games, expected, lambda)
}

// requiredWinRateForGames inverts the naive model: the win rate needed
// to cover the climb in `games` decisive games. Null for non-climbs or
// when the answer exceeds 100%.
export function requiredWinRateForGames(input: ProjectionInput, games: number): number | null {
  const distance = input.targetScore - input.currentScore
  if (distance <= 0 || games <= 0) return null
  const p = breakEven(input) + (50 * distance) / (input.meterMovePct * games)
  return p <= 1 ? p : null
}

export interface DecayProjection {
  impliedTrueScore: number // where the current win rate would hit 50%
  reachable: boolean
  expectedGames: number | null
  games95: GamesRange
  requiredWinRate: number | null // to make an unreachable climb reachable
}

// decayGamesAt: games to reach the target when WR decays toward 50% at
// the implied true rank T(p) — ln((T−x₀)/(T−x_t)) / (2·s·s_m). Null
// when the target is not strictly between the current score and T.
function decayGamesAt(input: ProjectionInput, p: number): number | null {
  const s = input.decaySlope
  const stepUnits = input.meterMovePct / 100
  const trueScore = input.currentScore + (p - breakEven(input)) / s
  const gapNow = trueScore - input.currentScore
  const gapTarget = trueScore - input.targetScore
  if (input.targetScore === input.currentScore) return 0
  if (gapNow === 0 || gapNow * gapTarget <= 0 || Math.abs(gapTarget) > Math.abs(gapNow)) return null
  return Math.log(gapNow / gapTarget) / (2 * s * stepUnits)
}

export function decayProjection(input: ProjectionInput): DecayProjection {
  const trueScore = input.currentScore + (input.winRate - breakEven(input)) / input.decaySlope
  const expected = decayGamesAt(input, input.winRate)
  const distance = input.targetScore - input.currentScore
  const unreachableClimb = expected === null && distance > 0
  return {
    impliedTrueScore: trueScore,
    reachable: expected !== null,
    expectedGames: expected,
    games95: wilsonGamesRange(input, (p) => decayGamesAt(input, p)),
    requiredWinRate: unreachableClimb ? breakEven(input) + input.decaySlope * distance : null,
  }
}

export interface ProjectionCurves {
  games: number[]
  naive: number[]
  decay: number[]
  bandLow: number[]
  bandHigh: number[]
  horizonGames: number
}

// curveHorizon picks the X-axis span: 1.5× the slower finite model
// estimate, clamped [50, 1500]; 250 when neither model gets there.
function curveHorizon(input: ProjectionInput): number {
  const finite = [
    naiveProjection(input).expectedGames,
    decayProjection(input).expectedGames,
  ].filter((g): g is number => g !== null && g > 0)
  if (finite.length === 0) return 250
  return Math.min(1500, Math.max(50, Math.ceil(1.5 * Math.max(...finite))))
}

// projectionCurves samples both trajectories plus the naive model's 95%
// band for the chart. Band variance folds the walk's own spread with
// the win-rate sampling error: V(g) = g·σ² + (2g·s_m·se_p)².
export function projectionCurves(
  input: ProjectionInput,
  opts?: { horizonGames?: number; points?: number },
): ProjectionCurves {
  const horizon = opts?.horizonGames ?? curveHorizon(input)
  const points = opts?.points ?? 120
  const stepUnits = input.meterMovePct / 100
  const pStar = breakEven(input)
  const drift = 2 * stepUnits * (input.winRate - pStar)
  const sigma2 = stepUnits * stepUnits * 4 * input.winRate * (1 - input.winRate)
  const trueScore = input.currentScore + (input.winRate - pStar) / input.decaySlope
  const iv = wilsonInterval(input.sampleWins, input.sampleWins + input.sampleLosses)
  const seP = iv === null ? 0 : (iv.upper - iv.lower) / (2 * 1.96)
  const clamp = (v: number) => Math.min(LADDER_MAX, Math.max(0, v))

  const out: ProjectionCurves = { games: [], naive: [], decay: [], bandLow: [], bandHigh: [], horizonGames: horizon }
  for (let i = 0; i <= points; i++) {
    const g = (horizon * i) / points
    const mean = input.currentScore + g * drift
    const spread = 1.96 * Math.sqrt(g * sigma2 + (2 * g * stepUnits * seP) ** 2)
    out.games.push(Math.round(g))
    out.naive.push(clamp(mean))
    out.decay.push(clamp(trueScore - (trueScore - input.currentScore) * Math.exp(-2 * input.decaySlope * stepUnits * g)))
    out.bandLow.push(clamp(mean - spread))
    out.bandHigh.push(clamp(mean + spread))
  }
  return out
}

// gamesToWeeks converts a games estimate to calendar weeks at the
// player's measured pace. Null when either side is unknown.
export function gamesToWeeks(games: number | null, gamesPerWeek: number | null): number | null {
  if (games === null || gamesPerWeek === null || gamesPerWeek <= 0) return null
  return games / gamesPerWeek
}

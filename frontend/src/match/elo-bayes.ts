// The Elo Calculator's Bayesian layer. One model: the player's true win
// rate p is a latent constant, every decisive match a noisy Bernoulli
// draw of it — "each match is random; the player is the constant".
// A Beta prior + the observed record give a closed-form Beta posterior;
// everything here is a readout of that posterior.
//
// The default prior is the SKEPTIC's: Beta(10, 10), centred hard on the
// "forced 50-50" belief with ~20 pseudo-games of stubbornness. Every
// probability shown is therefore conservative — the player's own games
// have to argue their way past the myth.

import { betaCdf } from '@/match/elo-stats'
import { LADDER_MAX } from '@/match/elo-model'
import type { ProjectionInput } from '@/match/elo-model'

export interface BetaPrior {
  alpha: number
  beta: number
}

export const SKEPTIC_PRIOR: BetaPrior = { alpha: 10, beta: 10 }

// probTrueWinRateAbove is P(true win rate > threshold | record) under the
// Beta posterior — the one-number anti-Elo-Hell verdict.
export function probTrueWinRateAbove(
  threshold: number,
  wins: number,
  losses: number,
  prior: BetaPrior = SKEPTIC_PRIOR,
): number {
  return 1 - betaCdf(threshold, prior.alpha + wins, prior.beta + losses)
}

export interface CredibleInterval {
  lower: number
  upper: number
}

// credibleInterval is the central credible interval on the true win rate —
// readable as a plain probability statement, unlike a frequentist CI.
export function credibleInterval(
  wins: number,
  losses: number,
  prior: BetaPrior = SKEPTIC_PRIOR,
  level = 0.95,
): CredibleInterval {
  const a = prior.alpha + wins
  const b = prior.beta + losses
  const tail = (1 - level) / 2
  return { lower: betaQuantile(tail, a, b), upper: betaQuantile(1 - tail, a, b) }
}

// betaQuantile inverts betaCdf by bisection — 80 halvings pin the answer
// far past display precision, and the CDF is cheap. Exported for the
// season simulator's inverse-CDF posterior sampling.
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0
  let hi = 1
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2
    if (betaCdf(mid, a, b) < q) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

// gamesToKnow is how many MORE decisive games it takes before the credible
// interval's half-width drops to `halfWidth` (a fraction, e.g. 0.03 = ±3
// points) — the honest "how long until we know" number. Normal
// approximation of the Beta width; the prior's pseudo-games count toward
// the effective sample.
export function gamesToKnow(
  wins: number,
  losses: number,
  halfWidth: number,
  prior: BetaPrior = SKEPTIC_PRIOR,
): number {
  const a = prior.alpha + wins
  const b = prior.beta + losses
  const nEff = a + b
  const p = a / nEff
  const nTotal = (p * (1 - p) * 1.96 * 1.96) / (halfWidth * halfWidth)
  return Math.max(0, Math.ceil(nTotal - nEff))
}

// shrunkWinRate is the empirical-Bayes adjusted rate for one hero: the
// hero's record updated against a prior centred on the POOLED rate with
// `strength` pseudo-games. A hot 3–0 lands near the pool; a long record
// barely moves — "the player is the constant" applied per hero. Null
// without a pool to shrink toward.
export function shrunkWinRate(
  wins: number,
  losses: number,
  poolWins: number,
  poolLosses: number,
  strength = 10,
): number | null {
  const poolN = poolWins + poolLosses
  if (poolN <= 0 || strength <= 0) return null
  const poolRate = poolWins / poolN
  return (wins + strength * poolRate) / (wins + losses + strength)
}

export interface SlopeCI {
  lowerPts: number
  upperPts: number
}

export interface CeilingRange {
  lo: number
  hi: number | null // null: the slope's own lower bound admits "no ceiling in sight"
}

// The slope denominator's floor, in win-rate points per division: below this
// the plateau identity divides by ~0 and the "ceiling" explodes into
// meaninglessness. A measured CI whose LOWER bound sits below the floor
// means the data can't bound the top at all — silently flooring it to 0.5
// would quote a hard upper edge the propagated envelope doesn't cover, so
// that case is open-top instead. The upper bound clamps to the dial's own
// maximum (5 pts/division), matching every other decay figure on the page.
const SLOPE_FLOOR_PTS = 0.5
const SLOPE_CAP_PTS = 5

// ceilingRange propagates BOTH uncertainties the "capped" verdict rests on —
// the true win rate (Beta posterior credible interval, shifted by any manual
// or hero-nudge delta so the range brackets the dialed rate at honest
// real-sample width) and the decay slope (its measured CI when available) —
// through the plateau identity T(p) = x0 + (p − 0.5)/s. The result is the
// honest alternative to the old single-point "Capped near X": tight on a
// well-measured 200-game form, enormous on three games.
export function ceilingRange(
  input: ProjectionInput,
  slopeCI: SlopeCI | null,
  prior: BetaPrior = SKEPTIC_PRIOR,
): CeilingRange {
  const n = input.sampleWins + input.sampleLosses
  const sampleRate = n > 0 ? input.sampleWins / n : 0.5
  const delta = input.winRate - sampleRate
  const iv = credibleInterval(input.sampleWins, input.sampleLosses, prior)
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
  const pLo = clamp01(iv.lower + delta)
  const pHi = clamp01(iv.upper + delta)

  const floorFrac = SLOPE_FLOOR_PTS / 100
  const capFrac = SLOPE_CAP_PTS / 100
  const openTop = slopeCI !== null && slopeCI.lowerPts < SLOPE_FLOOR_PTS
  const clampSlope = (pts: number): number => Math.min(capFrac, Math.max(floorFrac, pts / 100))
  const sLo = clampSlope(slopeCI?.lowerPts ?? input.decaySlope * 100)
  const sHi = clampSlope(slopeCI?.upperPts ?? input.decaySlope * 100)

  const pStar = input.plateauRate ?? 0.5
  const clampLadder = (v: number): number => Math.min(LADDER_MAX, Math.max(0, v))
  // T(p, s) = x0 + (p − p*)/s is monotone in p but flips direction in s
  // with the sign of (p − p*), so the honest envelope is the four corners.
  const corners = [
    input.currentScore + (pLo - pStar) / sLo,
    input.currentScore + (pLo - pStar) / sHi,
    input.currentScore + (pHi - pStar) / sLo,
    input.currentScore + (pHi - pStar) / sHi,
  ]
  const lo = clampLadder(Math.min(...corners))
  const hi = openTop ? null : clampLadder(Math.max(...corners))
  return { lo, hi }
}

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

import { betaCdf, inverseGaussianCdf } from '@/match/elo-stats'
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

export interface ClimbQuantiles {
  p10: number | null // fastest-decile games; null when swallowed by never-mass
  p50: number | null
  p90: number | null
  pNever: number // posterior mass at or below the 50% wall — futures that never arrive
}

// posteriorClimbQuantiles folds BOTH uncertainties into one distribution of
// games-to-target: the posterior over the true win rate (sample size) and
// the walk's own luck (first-passage inverse Gaussian at each rate). The
// posterior is discretised into equal-mass slices; each slice above the
// 50% wall contributes its IG first-passage CDF, slices at or below it
// contribute never-mass. Climbs only (D > 0) — descent reads as null.
export function posteriorClimbQuantiles(
  input: ProjectionInput,
  prior: BetaPrior = SKEPTIC_PRIOR,
  slices = 101,
): ClimbQuantiles | null {
  const distance = input.targetScore - input.currentScore
  const step = input.meterMovePct / 100
  if (distance <= 0 || step <= 0) return null
  const a = prior.alpha + input.sampleWins
  const b = prior.beta + input.sampleLosses

  const climbing: { mu: number; lambda: number }[] = []
  let neverSlices = 0
  for (let j = 0; j < slices; j++) {
    const p = betaQuantile((j + 0.5) / slices, a, b)
    if (p <= 0.5) {
      neverSlices++
      continue
    }
    const drift = step * (2 * p - 1)
    const sigma2 = step * step * 4 * p * (1 - p)
    climbing.push({ mu: distance / drift, lambda: (distance * distance) / sigma2 })
  }
  const pNever = neverSlices / slices

  const mixtureCdf = (t: number): number => {
    let sum = 0
    for (const s of climbing) sum += inverseGaussianCdf(t, s.mu, s.lambda)
    return sum / slices
  }
  const quantile = (q: number): number | null => {
    if (q > 1 - pNever - 1e-9) return null
    let hi = 64
    while (mixtureCdf(hi) < q && hi < 1e7) hi *= 2
    let lo = 0
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2
      if (mixtureCdf(mid) < q) lo = mid
      else hi = mid
    }
    return Math.max(1, Math.round((lo + hi) / 2))
  }

  return { p10: quantile(0.1), p50: quantile(0.5), p90: quantile(0.9), pNever }
}

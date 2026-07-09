// Numeric primitives for the Elo Calculator — pure statistics, no
// MatchRecord knowledge. Implemented by hand (no stats dependency):
// display-grade accuracy is all the calculator needs.

// normalCdf is Φ(z), the standard normal CDF, via the Abramowitz &
// Stegun 7.1.26 erf approximation (|error| < 1.5e-7 — display-grade).
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const poly =
    t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))))
  const erf = 1 - poly * Math.exp(-x * x)
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf)
}

// binomialTwoSidedP is the EXACT two-sided binomial test of the observed
// record against a fair coin (H₀: p = 0.5). Because Binomial(n, ½) is
// symmetric, "sum of all outcomes at most as likely as the observed one"
// collapses exactly to twice the smaller tail. Log-space incremental
// terms — no lgamma, no overflow — valid for n up to ~10⁵. Null when
// there is no sample.
export function binomialTwoSidedP(wins: number, total: number): number | null {
  if (total <= 0) return null
  const tail = Math.min(wins, total - wins)
  let logTerm = total * Math.log(0.5) // log P(X = 0)
  let sum = 0
  for (let k = 0; k <= tail; k++) {
    sum += Math.exp(logTerm)
    logTerm += Math.log((total - k) / (k + 1))
  }
  return Math.min(1, 2 * sum)
}

// inverseGaussianCdf is P(N ≤ t) for the Inverse Gaussian(μ, λ)
// distribution — the first-passage-time law of the drifted random walk
// the naive climb model uses. The textbook form Φ(z₁) + e^{2λ/μ}Φ(−z₂)
// overflows for large λ/μ; the exact identity 2λ/μ − z₂²/2 = −z₁²/2
// lets the second term switch to an asymptotic Mills-ratio expansion
// when z₂ is large, so the function is stable everywhere.
export function inverseGaussianCdf(t: number, mu: number, lambda: number): number {
  if (t <= 0) return 0
  const sqrtLt = Math.sqrt(lambda / t)
  const z1 = sqrtLt * (t / mu - 1)
  const z2 = sqrtLt * (t / mu + 1)
  return normalCdf(z1) + igSecondTerm(z1, z2, mu, lambda)
}

// igSecondTerm computes e^{2λ/μ}·Φ(−z₂) without overflow: direct when
// z₂ is small (2λ/μ = (z₂² − z₁²)/4 is then bounded), else via
// exp(−z₁²/2)·mills(z₂) using the identity above.
function igSecondTerm(z1: number, z2: number, mu: number, lambda: number): number {
  if (z2 <= 8) {
    return Math.exp((2 * lambda) / mu) * normalCdf(-z2)
  }
  const mills = (1 - 1 / (z2 * z2) + 3 / (z2 * z2 * z2 * z2)) / (z2 * Math.sqrt(2 * Math.PI))
  return Math.exp((-z1 * z1) / 2) * mills
}

// lossStreakChance is P(at least one run of `streakLen` consecutive
// losses within the next `horizonGames` decisive games) at the given
// win rate — the "streaks are expected, not rigged" number. Standard
// dynamic program over the trailing-loss-count states, O(N·k).
export function lossStreakChance(winRate: number, streakLen: number, horizonGames: number): number {
  if (streakLen <= 0) return 1
  if (streakLen > horizonGames) return 0
  const lose = 1 - winRate
  // state[i] = P(alive with exactly i trailing losses); absorbed = hit the streak.
  let state = new Array<number>(streakLen).fill(0)
  state[0] = 1
  let absorbed = 0
  for (let g = 0; g < horizonGames; g++) {
    const next = new Array<number>(streakLen).fill(0)
    for (let i = 0; i < streakLen; i++) {
      const mass = state[i] ?? 0
      if (mass === 0) continue
      next[0] = (next[0] ?? 0) + mass * winRate
      if (i + 1 === streakLen) absorbed += mass * lose
      else next[i + 1] = (next[i + 1] ?? 0) + mass * lose
    }
    state = next
  }
  return Math.min(1, absorbed)
}

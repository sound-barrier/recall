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

// lgamma is ln Γ(x) via the Lanczos approximation (g = 7, n = 9) — the
// workhorse behind the incomplete-beta function. ~15 significant digits.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028,
  771.32342877765313, -176.61502916214059, 12.507343278686905,
  -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
] as const

function lgamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x)
  const z = x - 1
  let acc = LANCZOS[0]
  for (let i = 1; i < LANCZOS.length; i++) acc += LANCZOS[i]! / (z + i)
  const t = z + 7.5
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(acc)
}

// betaCdf is the regularized incomplete beta I_x(a, b) — the Beta(a, b)
// CDF — via the Numerical-Recipes continued fraction, switched at the
// symmetry point for convergence. Powers Bayesian posteriors + tCdf.
export function betaCdf(x: number, a: number, b: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnFront = lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x)
  const front = Math.exp(lnFront)
  if (x < (a + 1) / (a + b + 2)) return (front * betaContinuedFraction(x, a, b)) / a
  return 1 - (front * betaContinuedFraction(1 - x, b, a)) / b
}

function betaContinuedFraction(x: number, a: number, b: number): number {
  const FPMIN = 1e-300
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < FPMIN) d = FPMIN
  d = 1 / d
  let h = d
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < FPMIN) d = FPMIN
    c = 1 + aa / c
    if (Math.abs(c) < FPMIN) c = FPMIN
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 3e-12) break
  }
  return h
}

// tCdf is the Student-t CDF (df > 0) through the incomplete beta:
// P(T ≤ t) = 1 − ½·I_{df/(df+t²)}(df/2, ½) for t ≥ 0, mirrored below.
export function tCdf(t: number, df: number): number {
  if (t === 0) return 0.5
  const tail = 0.5 * betaCdf(df / (df + t * t), df / 2, 0.5)
  return t > 0 ? 1 - tail : tail
}

export interface RunsTestResult {
  runs: number
  expectedRuns: number
  z: number
  pValue: number
  nWins: number
  nLosses: number
}

// runsTest is the Wald–Wolfowitz runs test on a win/loss sequence: do
// results cluster more (or alternate more) than an iid coin at the same
// rate would? z < 0 = streakier than chance. Normal approximation, so
// it needs at least ten of each outcome; null below that.
export function runsTest(results: readonly boolean[]): RunsTestResult | null {
  let nWins = 0
  let nLosses = 0
  let runs = 0
  for (let i = 0; i < results.length; i++) {
    if (results[i]) nWins++
    else nLosses++
    if (i === 0 || results[i] !== results[i - 1]) runs++
  }
  if (nWins < 10 || nLosses < 10) return null
  const n = nWins + nLosses
  const expectedRuns = 1 + (2 * nWins * nLosses) / n
  const variance = (2 * nWins * nLosses * (2 * nWins * nLosses - n)) / (n * n * (n - 1))
  if (variance <= 0) return null
  const z = (runs - expectedRuns) / Math.sqrt(variance)
  return { runs, expectedRuns, z, pValue: Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))), nWins, nLosses }
}

export interface LogisticSlopeFit {
  slope: number // logit units per x unit
  se: number // standard error of the slope
  meanRate: number // fitted win probability at the centered mean x
  n: number
}

// logisticSlope fits P(win) = σ(a + b·(x − x̄)) by Newton–Raphson and
// returns the slope with its standard error — the engine behind the
// measured decay slope. Null on degenerate data (one class, no x
// spread, too few points) and on complete separation (a runaway MLE
// says the data can't identify a finite slope).
export function logisticSlope(xs: readonly number[], wins: readonly boolean[]): LogisticSlopeFit | null {
  const n = Math.min(xs.length, wins.length)
  if (n < 10) return null
  const winCount = wins.slice(0, n).filter(Boolean).length
  if (winCount === 0 || winCount === n) return null
  const meanX = xs.slice(0, n).reduce((s, v) => s + v, 0) / n
  const xc = xs.slice(0, n).map((v) => v - meanX)
  if (Math.max(...xc) - Math.min(...xc) <= 0) return null

  let a = Math.log(winCount / (n - winCount))
  let b = 0
  let h00 = 0
  let h01 = 0
  let h11 = 0
  for (let iter = 0; iter < 60; iter++) {
    let g0 = 0
    let g1 = 0
    h00 = 0
    h01 = 0
    h11 = 0
    for (let i = 0; i < n; i++) {
      const p = 1 / (1 + Math.exp(-(a + b * xc[i]!)))
      const y = wins[i] ? 1 : 0
      const w = p * (1 - p)
      g0 += y - p
      g1 += (y - p) * xc[i]!
      h00 += w
      h01 += w * xc[i]!
      h11 += w * xc[i]! * xc[i]!
    }
    const det = h00 * h11 - h01 * h01
    if (!Number.isFinite(det) || det <= 1e-12) return null
    const da = (h11 * g0 - h01 * g1) / det
    const db = (h00 * g1 - h01 * g0) / det
    a += da
    b += db
    if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 50) return null
    if (Math.abs(da) + Math.abs(db) < 1e-10) break
  }
  const det = h00 * h11 - h01 * h01
  if (!Number.isFinite(det) || det <= 1e-12) return null
  return { slope: b, se: Math.sqrt(h00 / det), meanRate: 1 / (1 + Math.exp(-a)), n }
}

// twoByTwoChiSquareP is the Yates-corrected chi-square p-value for a
// 2×2 table (1 df, via P(χ² > x) = 2(1 − Φ(√x))) — the "is the tilt
// dip real?" test. Null when any expected cell is under 5 (the
// approximation isn't trustworthy there).
export function twoByTwoChiSquareP(a: number, b: number, c: number, d: number): number | null {
  const n = a + b + c + d
  const r1 = a + b
  const r2 = c + d
  const c1 = a + c
  const c2 = b + d
  if (n === 0 || r1 === 0 || r2 === 0 || c1 === 0 || c2 === 0) return null
  const expectedMin = Math.min((r1 * c1) / n, (r1 * c2) / n, (r2 * c1) / n, (r2 * c2) / n)
  if (expectedMin < 5) return null
  const diff = Math.abs(a * d - b * c) - n / 2
  if (diff <= 0) return 1
  const chi2 = (n * diff * diff) / (r1 * r2 * c1 * c2)
  return Math.min(1, 2 * (1 - normalCdf(Math.sqrt(chi2))))
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

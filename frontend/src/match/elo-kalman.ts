// The "true skill" curve: a local-level Kalman filter + RTS smoother over
// the track's rank readings. The model says the visible rank y_t is a
// noisy observation (variance R) of a latent skill x_t that drifts as a
// random walk (variance Q). The smoothed x is the de-noised skill curve,
// and the Q/R split quantifies the anti-Elo-Hell verdict directly:
// signalShare = Q / (Q + 2R) is the share of per-reading rank movement
// that is real skill drift — the rest is matchmaking noise.
//
// Honest simplification: readings are treated as evenly spaced steps
// (per reading, not calendar time) — a dense session and a week apart
// count the same. Fine for the verdict; noted in the UI's fine print.

export interface SkillCurve {
  t: number[] // epoch ms per reading, aligned with level/halfWidth
  level: number[] // smoothed latent skill (ladder units)
  halfWidth: number[] // 1.96σ of the smoothed state
  q: number // process (skill-drift) variance per step
  r: number // observation (matchmaking noise) variance
  signalShare: number // Q / (Q + 2R) — share of movement that is skill
  // True when the R clamp fired: the diffs were positively autocorrelated
  // (a steady one-way climb), which the local-level model cannot produce —
  // cov₁(d) = −R ≤ 0 by construction — so the ~100% signalShare is a
  // model-misfit artifact, not a measurement, and the UI must refuse it.
  // (The Q clamp is different: var ≤ 2R honestly reads "no drift evidence",
  // so a ~0% share stands.)
  saturated: boolean
  n: number
}

// MIN_READINGS: below this the moment estimates are noise about noise.
const MIN_READINGS = 12
// EPS keeps the clamped variances strictly positive so the filter's
// gains stay defined even on degenerate moment estimates.
const EPS = 1e-4

// skillCurve estimates (Q, R) by method of moments on the diff series —
// for the local-level model, var(d) = Q + 2R and cov₁(d) = −R — then
// runs the standard forward filter and RTS backward smoother. Null when
// the series is too short or flat to say anything.
export function skillCurve(points: readonly { t: number; score: number }[]): SkillCurve | null {
  const n = points.length
  if (n < MIN_READINGS) return null
  const ys = points.map((p) => p.score)

  const diffs: number[] = []
  for (let i = 1; i < n; i++) diffs.push(ys[i]! - ys[i - 1]!)
  const m = diffs.length
  const mean = diffs.reduce((s, v) => s + v, 0) / m
  let variance = 0
  for (const v of diffs) variance += (v - mean) * (v - mean)
  variance /= m - 1
  if (variance === 0) return null
  let cov1 = 0
  for (let i = 1; i < m; i++) cov1 += (diffs[i - 1]! - mean) * (diffs[i]! - mean)
  cov1 /= m - 1

  const r = Math.max(EPS, -cov1)
  const q = Math.max(EPS, variance - 2 * r)
  const saturated = r === EPS

  // Forward pass (filter): x₀ = y₀, P₀ = R.
  const filtLevel = new Array<number>(n)
  const filtVar = new Array<number>(n)
  filtLevel[0] = ys[0]!
  filtVar[0] = r
  for (let i = 1; i < n; i++) {
    const predVar = filtVar[i - 1]! + q
    const gain = predVar / (predVar + r)
    filtLevel[i] = filtLevel[i - 1]! + gain * (ys[i]! - filtLevel[i - 1]!)
    filtVar[i] = (1 - gain) * predVar
  }

  // Backward pass (RTS smoother). For the local level the prediction is
  // the filtered state itself, so the recursion simplifies.
  const level = [...filtLevel]
  const smoothVar = [...filtVar]
  for (let i = n - 2; i >= 0; i--) {
    const c = filtVar[i]! / (filtVar[i]! + q)
    level[i] = filtLevel[i]! + c * (level[i + 1]! - filtLevel[i]!)
    smoothVar[i] = filtVar[i]! + c * c * (smoothVar[i + 1]! - (filtVar[i]! + q))
  }

  return {
    t: points.map((p) => p.t),
    level,
    halfWidth: smoothVar.map((v) => 1.96 * Math.sqrt(Math.max(0, v))),
    q,
    r,
    signalShare: q / (q + 2 * r),
    saturated,
    n,
  }
}

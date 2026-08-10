// Sample-size honesty helpers (audit product gap): winrate rankings
// must not let a thin perfect sample outrank a solid good one.

// LOW_SAMPLE_N is the "thin sample" line: rows with fewer decisive
// matches carry a visible caveat in the winrate breakdowns. Five
// matches ≈ the point where a single result stops swinging the
// percentage by 20+ points.
export const LOW_SAMPLE_N = 5

// WilsonInterval is the full Wilson score 95% confidence interval for
// a win rate, as fractions in [0, 1].
export interface WilsonInterval {
  lower: number
  upper: number
}

// wilsonInterval returns both bounds of the Wilson score 95% interval
// for `wins` out of `total` decisive matches, or null when there is no
// sample. The single shared implementation — wilsonLowerBound and
// wilsonMargin are views over it.
export function wilsonInterval(wins: number, total: number): WilsonInterval | null {
  if (total <= 0) return null
  const z = 1.96
  const z2 = z * z
  const p = wins / total
  const denominator = 1 + z2 / total
  const center = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))
  return { lower: (center - spread) / denominator, upper: (center + spread) / denominator }
}

// wilsonLowerBound returns the lower bound of the Wilson score 95%
// confidence interval for `wins` out of `total` decisive matches.
// Used as the SORT key for winrate rankings: the displayed
// percentage stays the raw winrate, but ranking by the interval's
// floor means "how good is this bucket, pessimistically?" — an n=3
// 100% bucket (floor ≈ 0.44) ranks below an n=12 75% one
// (floor ≈ 0.47). Total of 0 returns 0.
export function wilsonLowerBound(wins: number, total: number): number {
  return wilsonInterval(wins, total)?.lower ?? 0
}

// wilsonMargin returns the DISPLAY half-width of the Wilson 95%
// interval in percentage points, rounded — the "± 8" in
// "62% ± 8 · n=14". The interval isn't symmetric around the raw
// winrate, so the display margin is half the interval's width (an
// honest single number beats a lopsided pair for a KPI sub-line).
// Null when there are no decisive matches.
export function wilsonMargin(wins: number, total: number): number | null {
  const interval = wilsonInterval(wins, total)
  if (interval === null) return null
  return Math.round(((interval.upper - interval.lower) / 2) * 100)
}

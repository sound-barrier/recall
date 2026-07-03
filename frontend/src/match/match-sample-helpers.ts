// Sample-size honesty helpers (audit product gap): winrate rankings
// must not let a thin perfect sample outrank a solid good one.

// LOW_SAMPLE_N is the "thin sample" line: rows with fewer decisive
// matches carry a visible caveat in the winrate breakdowns. Five
// matches ≈ the point where a single result stops swinging the
// percentage by 20+ points.
export const LOW_SAMPLE_N = 5

// wilsonLowerBound returns the lower bound of the Wilson score 95%
// confidence interval for `wins` out of `total` decisive matches.
// Used as the SORT key for winrate rankings: the displayed
// percentage stays the raw winrate, but ranking by the interval's
// floor means "how good is this bucket, pessimistically?" — an n=3
// 100% bucket (floor ≈ 0.44) ranks below an n=12 75% one
// (floor ≈ 0.47). Total of 0 returns 0.
export function wilsonLowerBound(wins: number, total: number): number {
  if (total <= 0) return 0
  const z = 1.96
  const z2 = z * z
  const p = wins / total
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))
  return (centre - spread) / denominator
}

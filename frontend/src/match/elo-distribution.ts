// Population placement for the Elo Calculator: where a rank sits among
// all competitive players, from Blizzard's published July 2025 rank
// distribution. The shares are ground truth — percentiles interpolate
// linearly within each tier band on the ladder axis rather than fitting
// a normal curve (a fit would add pseudo-precision and stop reproducing
// the published numbers exactly).

// RankBand is one tier's slice of the ladder: [lo, lo+width) in
// ladderScore units with its published share of the population.
export interface RankBand {
  label: string
  lo: number
  width: number
  share: number // percent of the population
}

// Blizzard's July 2025 competitive distribution. Grandmaster and
// Champion were published as one combined 0.3% share, so they form a
// single band spanning both tiers (10 ladder units). Shares sum to 100.
export const RANK_DISTRIBUTION_JULY_2025: readonly RankBand[] = [
  { label: 'Bronze', lo: 0, width: 5, share: 2.4 },
  { label: 'Silver', lo: 5, width: 5, share: 12.6 },
  { label: 'Gold', lo: 10, width: 5, share: 31.7 },
  { label: 'Platinum', lo: 15, width: 5, share: 34.9 },
  { label: 'Diamond', lo: 20, width: 5, share: 14.9 },
  { label: 'Master', lo: 25, width: 5, share: 3.2 },
  { label: 'Grandmaster + Champion', lo: 30, width: 10, share: 0.3 },
]

// populationPercentile maps a ladderScore to "better than X% of
// competitive players": the cumulative share below the score's band
// plus a linear fraction of the band's own share. Clamped to [0, 40].
export function populationPercentile(score: number): number {
  const s = Math.min(40, Math.max(0, score))
  let cumulative = 0
  for (const band of RANK_DISTRIBUTION_JULY_2025) {
    if (s >= band.lo + band.width) {
      cumulative += band.share
      continue
    }
    return cumulative + band.share * ((s - band.lo) / band.width)
  }
  return 100
}

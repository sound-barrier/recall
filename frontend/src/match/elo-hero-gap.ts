// The best-vs-worst hero gap: an approximation of how much faster the
// climb goes on your best heroes than your worst — the per-game meter
// difference, translated into divisions. Only heroes with real evidence
// qualify (the same 15-decisive floor the judgment colours use), rates
// are the shrunk ones (a hot small record can't headline), and the block
// stays silent when the spread is too small to be advice.

import type { HeroPickStat } from '@/match/elo-seed'
import { expectedMeterDelta, type MeterSamples } from '@/match/elo-simulate'

export interface HeroGap {
  best: HeroPickStat
  worst: HeroPickStat
  bestPerGamePts: number // expected meter move per game on the best hero
  worstPerGamePts: number
  gapPerGamePts: number // best − worst, percentage points of meter per game
}

const GAP_MIN_DECISIVE = 15
const GAP_MIN_RATE_PTS = 5

// gapRate is the rate the approximation trusts: the shrunk rate when the
// sample is small enough for shrinking to matter, else the raw one.
function gapRate(h: HeroPickStat): number {
  return h.adjustedWinrate ?? h.winrate
}

// perGamePts prices a win rate in meter points per game: the player's own
// signed pools when they're deep enough, else the symmetric fallback
// (2p−1)·meterMovePct — the naive model's drift.
function perGamePts(samples: MeterSamples, ratePct: number, meterMovePct: number): number {
  const empirical = expectedMeterDelta(samples, ratePct / 100)
  if (empirical !== null) return empirical
  return (2 * (ratePct / 100) - 1) * meterMovePct
}

// heroClimbGap picks the strongest and weakest evidenced heroes and
// prices the difference. Null when fewer than two heroes qualify or the
// spread is under GAP_MIN_RATE_PTS (no advice worth giving).
export function heroClimbGap(
  stats: readonly HeroPickStat[],
  samples: MeterSamples,
  meterMovePct: number,
): HeroGap | null {
  const qualified = stats.filter((h) => h.wins + h.losses >= GAP_MIN_DECISIVE)
  if (qualified.length < 2) return null
  const sorted = [...qualified].sort((a, b) => gapRate(b) - gapRate(a))
  const best = sorted[0]!
  const worst = sorted[sorted.length - 1]!
  if (gapRate(best) - gapRate(worst) < GAP_MIN_RATE_PTS) return null
  const bestPerGamePts = perGamePts(samples, gapRate(best), meterMovePct)
  const worstPerGamePts = perGamePts(samples, gapRate(worst), meterMovePct)
  return {
    best,
    worst,
    bestPerGamePts,
    worstPerGamePts,
    gapPerGamePts: bestPerGamePts - worstPerGamePts,
  }
}

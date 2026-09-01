import { matchEpoch } from '@/match/trends/match-trends-helpers'
import type { MomentumInput, RateSample } from '@/match/dossier/match-momentum-helpers'

/**
 * How long the player waited before queuing again — kept as a NUMBER.
 *
 * Everything else here binarizes this. SESSION_GAP_HOURS turns the gap into
 * "same session or not"; breakRust turns it into "rusty or not". Both throw
 * away the size, which is the whole subject of the question this answers: does
 * queuing straight back in after a loss cost you, compared with coming back
 * later?
 */

const MINUTE_MS = 60_000

/** A re-queue: back in the queue before the last game had time to settle. */
export const TILTED_GAP_MINUTES = 5

/** A break long enough that the next game starts fresh. */
export const FRESH_GAP_MINUTES = 60

/**
 * Minutes between each match and the one before it, in time order.
 *
 * One shorter than the input: the first match has nothing before it, and
 * inventing a gap for it would put a fabricated number in every average.
 * Matches with no placeable time drop out — a gap measured against a match
 * that could be anywhere is not a measurement.
 */
export function queueGapMinutes(records: readonly MomentumInput[]): number[] {
  const times: number[] = []
  for (const rec of records) {
    const t = matchEpoch(rec)
    if (t != null) times.push(t)
  }
  times.sort((a, b) => a - b)
  const gaps: number[] = []
  for (let i = 1; i < times.length; i++) {
    gaps.push(Math.round((times[i]! - times[i - 1]!) / MINUTE_MS))
  }
  return gaps
}

export interface QueueGapSplit {
  /** Matches entered within TILTED_GAP_MINUTES of the last one ending. */
  tilted: RateSample
  /** Matches entered after at least FRESH_GAP_MINUTES away. */
  fresh: RateSample
}

/**
 * Win rate by how long the player waited before queuing.
 *
 * The band BETWEEN the two thresholds is deliberately in neither: a
 * twenty-minute gap is not a re-queue and not a break, and forcing it into one
 * side would fill both with the least meaningful matches. Draws are out, like
 * every other win rate here.
 */
export function freshVsTilted(records: readonly MomentumInput[]): QueueGapSplit {
  const timed: { t: number; result: string | undefined }[] = []
  for (const r of records) {
    const t = matchEpoch(r)
    if (t != null) timed.push({ t, result: r.data?.result })
  }
  timed.sort((a, b) => a.t - b.t)

  const tilted = { wins: 0, n: 0 }
  const fresh = { wins: 0, n: 0 }
  for (let i = 1; i < timed.length; i++) {
    const side = sideFor(timed[i]!.result, (timed[i]!.t - timed[i - 1]!.t) / MINUTE_MS, tilted, fresh)
    if (!side) continue
    side.n++
    if (timed[i]!.result === 'victory') side.wins++
  }
  return { tilted: rate(tilted.wins, tilted.n), fresh: rate(fresh.wins, fresh.n) }
}

/**
 * Which side of the split a match falls on, or nothing.
 *
 * Nothing is the common answer: a draw is not a win rate, and the band BETWEEN
 * the thresholds is deliberately neither — a twenty-minute gap is not a
 * re-queue and not a break.
 */
function sideFor<T>(result: string | undefined, gapMinutes: number, tilted: T, fresh: T): T | null {
  if (result !== 'victory' && result !== 'defeat') return null
  if (gapMinutes <= TILTED_GAP_MINUTES) return tilted
  if (gapMinutes >= FRESH_GAP_MINUTES) return fresh
  return null
}

function rate(wins: number, sample: number): RateSample {
  return { winrate: sample > 0 ? Math.round((wins / sample) * 100) : null, sample }
}

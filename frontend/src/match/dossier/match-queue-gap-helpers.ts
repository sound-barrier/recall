import type { MatchRecord } from '@/api-client'
import type { RateSample } from '@/match/dossier/match-momentum-helpers'
import { matchInstantUTC } from '@/match/match-time-helpers'
import { matchStartUTC } from '@/match/match-season-helpers'

/**
 * How long the player waited before queuing again — kept as a NUMBER.
 *
 * Everything else here binarizes this. SESSION_GAP_HOURS turns the gap into
 * "same session or not"; breakRust turns it into "rusty or not". Both throw
 * away the size, which is the whole subject of the question this answers: does
 * queuing straight back in after a loss cost you, compared with coming back
 * later?
 *
 * The gap is measured from the previous match's END to this one's START. It
 * used to be finish-to-finish, which silently added the whole duration of the
 * second game: with a median match around fourteen minutes, "back in the queue
 * within five" could not happen, and the tilted side of the split was empty
 * for everybody.
 */

const MINUTE_MS = 60_000

/** A re-queue: back in the queue before the last game had time to settle. */
export const TILTED_GAP_MINUTES = 5

/** A break long enough that the next game starts fresh. */
export const FRESH_GAP_MINUTES = 60

// One match's place in time: when it started, when it ended, how it went.
// Both instants are UTC, because a naive wall clock compares two different
// clocks for a player who has changed timezone.
interface Played {
  start: number
  end: number
  result: string | undefined
}

function playedInOrder(records: readonly MatchRecord[]): Played[] {
  const out: Played[] = []
  for (const rec of records) {
    const start = matchStartUTC(rec)
    const iso = matchInstantUTC(rec)
    const end = iso ? Date.parse(iso) : NaN
    // A match that cannot be placed in time is not a measurement: a gap taken
    // against it could be anything.
    if (start === null || Number.isNaN(end)) continue
    out.push({ start, end, result: rec.data?.result })
  }
  return out.sort((a, b) => a.start - b.start)
}

/**
 * Minutes waited before each match, in time order.
 *
 * One shorter than the input: the first match has nothing before it, and
 * inventing a gap for it would put a fabricated number in every average.
 * Negative gaps are dropped rather than clamped — overlapping matches mean the
 * two timestamps disagree, and a "0-minute wait" from bad data is a claim.
 */
export function queueGapMinutes(records: readonly MatchRecord[]): number[] {
  return gapsWithResult(records).map(({ gapMinutes }) => Math.round(gapMinutes))
}

function gapsWithResult(records: readonly MatchRecord[]): { gapMinutes: number; result: string | undefined }[] {
  const played = playedInOrder(records)
  const out: { gapMinutes: number; result: string | undefined }[] = []
  for (let i = 1; i < played.length; i++) {
    const gapMinutes = (played[i]!.start - played[i - 1]!.end) / MINUTE_MS
    if (gapMinutes < 0) continue
    out.push({ gapMinutes, result: played[i]!.result })
  }
  return out
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
export function freshVsTilted(records: readonly MatchRecord[]): QueueGapSplit {
  const tilted = { wins: 0, n: 0 }
  const fresh = { wins: 0, n: 0 }
  for (const { gapMinutes, result } of gapsWithResult(records)) {
    const side = sideFor(result, gapMinutes, tilted, fresh)
    if (!side) continue
    side.n++
    if (result === 'victory') side.wins++
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

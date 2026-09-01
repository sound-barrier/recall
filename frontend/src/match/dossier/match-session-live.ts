import type { MatchRecord } from '@/api-client'
import {
  currentSessionSummary, latestSessionKeys, SESSION_GAP_HOURS, type SessionSummary,
} from '@/match/dossier/match-momentum-helpers'
import { currentRankByRole, matchEpoch, roleBucket, type RankNow } from '@/match/trends/match-trends-helpers'

/**
 * The running session, joined to where the player currently sits on the
 * ladder.
 *
 * Four surfaces already spell a session tally. The one thing none of them
 * carries is the rank the session is moving — which is the whole question a
 * player mid-climb is asking, so it is the reason this readout exists rather
 * than a fifth copy of W-L.
 */
export interface LiveSessionReadout {
  /**
   * The session, tallied over the ROLE in play — not over every queue.
   *
   * The rank beside it is per-role, because the ladder is, so a movement
   * summed across roles would sit next to a pill it did not move: two support
   * wins and a tank loss printed the support pill and a +22% the tank ladder
   * never saw. Scoping the tally is what makes the two numbers one claim.
   */
  summary: SessionSummary
  /** The role bucket of the session's NEWEST match — the queue in play now. */
  role: string
  roleLabel: string
  /** Null when the session's role has no readable rank anywhere in history. */
  rank: RankNow | null
}

export function liveSessionReadout(
  records: readonly MatchRecord[],
  now: number = Date.now(),
  gapHours: number = SESSION_GAP_HOURS,
): LiveSessionReadout | null {
  // Is a session running at all? Asked over every queue, because a session is
  // a stretch of play, not a stretch of one role.
  if (currentSessionSummary(records, now, gapHours) === null) return null

  // The session IS the trailing run ending at the newest match, so the newest
  // match overall is the newest in the session — no filter needed, and one
  // that looked prudent was proven dead by a mutation that changed nothing.
  const newest = newestOf(records)
  if (newest === null) return null

  const bucket = roleBucket(newest)
  const inSession = new Set(latestSessionKeys(records, gapHours))
  // Re-tallied over the role in play. The rank pill is per-role; a movement
  // summed across roles would be attributed to a ladder it never touched.
  const summary = currentSessionSummary(
    records.filter((r) => !inSession.has(r.match_key) || roleBucket(r).key === bucket.key),
    now,
    gapHours,
  )
  if (summary === null) return null

  // The rank comes from the WHOLE history, not the session: a session can run
  // for six games without a single rank screen, and the last reading before it
  // is still where the player is.
  const rank = currentRankByRole(records).find((r) => r.key === bucket.key) ?? null
  return { summary, role: bucket.key, roleLabel: bucket.label, rank }
}

function newestOf(records: readonly MatchRecord[]): MatchRecord | null {
  let best: MatchRecord | null = null
  let bestT = -Infinity
  for (const r of records) {
    const t = matchEpoch(r)
    if (t === null || t < bestT) continue
    best = r
    bestT = t
  }
  return best
}

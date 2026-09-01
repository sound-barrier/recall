import type { MatchRecord } from '@/api-client'
import {
  currentSessionSummary, SESSION_GAP_HOURS, type SessionSummary,
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
  const summary = currentSessionSummary(records, now, gapHours)
  if (summary === null) return null

  // The session IS the trailing run ending at the newest match, so the newest
  // match overall is the newest in the session — no filter needed, and one
  // that looked prudent was proven dead by a mutation that changed nothing.
  const newest = newestOf(records)
  if (newest === null) return null

  const bucket = roleBucket(newest)
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

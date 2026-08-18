import type { MatchRecord } from '@/api'

/**
 * One coach's one sitting, reassembled from the blocks that landed on
 * matches. The app keeps no separate record of a received review —
 * `(coach_name, session_date)` is its identity, because that is what every
 * block carries and what a notes file is: one coach, one sitting.
 */
export interface ReceivedReview {
  coachName: string
  sessionDate: string
  noteCount: number
  /** Every match the review touched, in match order. */
  matchKeys: string[]
}

/** Newest sitting first; ties broken by coach name so the order is stable. */
export function groupReceivedReviews(records: readonly MatchRecord[]): ReceivedReview[] {
  const byKey = new Map<string, ReceivedReview>()
  for (const r of records) {
    for (const n of r.coach_notes ?? []) {
      const id = `${n.coach_name} ${n.session_date}`
      const g = byKey.get(id) ?? {
        coachName: n.coach_name, sessionDate: n.session_date, noteCount: 0, matchKeys: [],
      }
      g.noteCount += 1
      if (!g.matchKeys.includes(r.match_key)) g.matchKeys.push(r.match_key)
      byKey.set(id, g)
    }
  }
  const out = [...byKey.values()]
  for (const g of out) g.matchKeys.sort()
  return out.sort((a, b) =>
    b.sessionDate.localeCompare(a.sessionDate) || a.coachName.localeCompare(b.coachName))
}

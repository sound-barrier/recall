import type { CoachReturnSheet, MatchRecord, ShareExport } from '@/api'
import { formatPlayerDay, localDay } from '@/match/coach/coach-time'
import { pluralize } from '@/match/match-label-helpers'

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

/** The return sheet a received review came from, when it is still around. */
export function sheetFor(
  inbox: readonly CoachReturnSheet[],
  r: { coachName: string; sessionDate: string },
): CoachReturnSheet | undefined {
  return inbox.find(s => s.coach_name === r.coachName && s.session_date === r.sessionDate)
}

/**
 * What that coach said to work on, as one line.
 *
 * Comes from the SHEET rather than the blocks, because focus items are the one
 * thing a coach writes about the set rather than about a match, so no block
 * carries them.
 */
export function focusLine(
  inbox: readonly CoachReturnSheet[],
  r: { coachName: string; sessionDate: string },
): string {
  return (sheetFor(inbox, r)?.focus_items ?? []).map(i => i.text).join(' · ')
}

/**
 * Which coach answered a sent set, if one has.
 *
 * The ledger records who SIGNED a bundle (you), never who received it, so the
 * answer has to be found: a sheet imported after the send whose notes overlap
 * the set. Falls back to the blocks on the matches, because a sheet can be
 * discarded once its notes are accepted and then the blocks are the only record
 * the answer ever arrived.
 */
export function answeringCoach(
  inbox: readonly CoachReturnSheet[],
  received: readonly ReceivedReview[],
  e: ShareExport,
): string {
  const sent = new Set(e.match_keys)
  const answer = inbox.find(sheet =>
    sheet.imported_at > e.exported_at && sheet.notes.some(n => sent.has(n.match_key)))
  if (answer) return answer.coach_name
  const block = received.find(r =>
    r.sessionDate >= e.exported_at.slice(0, 10) && r.matchKeys.some(k => sent.has(k)))
  return block?.coachName ?? ''
}

/** The sent ledger's row: what left, and when, in the viewer's day. */
export function sentLine(e: { match_keys: string[]; exported_at: string }): string {
  return `Sent ${pluralize(e.match_keys.length, 'match', 'matches')} · ${localDay(e.exported_at)}`
}

/** A waiting card's line: how much is here, and from whom. */
export function notesFromLine(count: number, coachName: string): string {
  return `${pluralize(count, 'note')} from ${coachName}`
}

/** A received card's line: when the sitting was, and how big. */
export function received02Label(
  r: { sessionDate: string; noteCount: number; matchKeys: readonly string[] },
): string {
  return [
    formatPlayerDay(r.sessionDate),
    pluralize(r.noteCount, 'note'),
    pluralize(r.matchKeys.length, 'match', 'matches'),
  ].join(' · ')
}

/** A roster row: who, how much of their work is kept, and when you last sat. */
export function rosterLine(
  p: { handle: string; note_count: number; last_note_at?: string },
): string {
  const last = p.last_note_at ? ` · last session ${localDay(p.last_note_at)}` : ''
  return `${p.handle} · ${pluralize(p.note_count, 'note')}${last}`
}

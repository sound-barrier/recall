// The Film Room's reel: the player's matches grouped by THEIR day (the naive
// `data.date`, per coach-time.ts), newest day and newest frame first — the
// order the Matches list uses, so the two agree on what "first" means.
// Pure; the room's composable derives from these.

import type { MatchRecord } from '@/api-client'
import { formatPlayerDay, playerClockDayKey, playerClockTime } from '@/match/coach/coach-time'
import { isReviewableMatchKey } from '@/match/match-key'
import { tallyWLD, type WLDTally } from '@/match/match-stats-helpers'

/** The record fields the reel reads — a narrower shape than MatchRecord so tests can feed minimal rows. */
export type ReelRecord = Pick<MatchRecord, 'match_key' | 'data' | 'hidden'>

export interface ReelDay<T extends ReelRecord = MatchRecord> {
  /** YYYY-MM-DD in the player's clock; '' for the trailing undated day. */
  dayKey: string
  /** "Fri · Aug 8", or "Undated". */
  label: string
  played: number
  wld: WLDTally
  frames: T[]
}

const UNDATED_LABEL = 'Undated'

function compareStrings(a: string, b: string): number {
  if (a < b) return -1
  if (a > b) return 1
  return 0
}

// Newest first: by the naive clock, then by match key so two frames in
// the same minute keep a stable order across re-renders.
function newestFirst<T extends ReelRecord>(a: T, b: T): number {
  return compareStrings(playerClockTime(b), playerClockTime(a)) || compareStrings(b.match_key, a.match_key)
}

function toReelDay<T extends ReelRecord>(dayKey: string, frames: T[]): ReelDay<T> {
  const ordered = [...frames].sort(newestFirst)
  return {
    dayKey,
    label: dayKey ? formatPlayerDay(dayKey) || dayKey : UNDATED_LABEL,
    played: ordered.length,
    wld: tallyWLD(ordered),
    frames: ordered,
  }
}

// A frame is an invitation to write a note, and design rule 6 allows a note
// only on a REVIEWABLE key — a real match, or a replay a coach was handed.
// The server 404s the `unmatched-` / `ambiguous-` sentinels, permanently. An
// "include unknown" export carries those records, so without this the reel
// would hand the coach an editor that accepts a paragraph and then loses it.
// A screenshot with no match is not a match to review; it never reaches the
// reel.
//
// This gate is the reason a code-only session works at all: left keyed on
// `isTrackedMatchKey`, every frame of one would be filtered out and the desk
// would tell the coach their session holds no matches to review.
function isReelable(rec: ReelRecord): boolean {
  return !rec.hidden && isReviewableMatchKey(rec.match_key ?? '')
}

/** Group reviewable records by the player's day: newest day first, undated last, frames newest first within a day. */
export function groupReelByPlayerDay<T extends ReelRecord>(records: T[]): ReelDay<T>[] {
  const byDay = new Map<string, T[]>()
  for (const rec of records) {
    if (!isReelable(rec)) continue
    const dayKey = playerClockDayKey(rec)
    const bucket = byDay.get(dayKey)
    if (bucket) bucket.push(rec)
    else byDay.set(dayKey, [rec])
  }
  const dated = [...byDay.keys()].filter((k) => k !== '').sort((a, b) => compareStrings(b, a))
  const keys = byDay.has('') ? [...dated, ''] : dated
  return keys.map((dayKey) => toReelDay(dayKey, byDay.get(dayKey)!))
}

/** "Fri · Aug 8 · 4 played · 2–2", with draws third ("1–1–1") only when there are any. */
export function reelDayHeader(day: Pick<ReelDay<ReelRecord>, 'label' | 'played' | 'wld'>): string {
  const { w, l, d } = day.wld
  const tally = d > 0 ? `${w}–${l}–${d}` : `${w}–${l}`
  return `${day.label} · ${day.played} played · ${tally}`
}

/** Every frame in reel order — what prev/next steps through. */
export function flattenReel<T extends ReelRecord>(days: Pick<ReelDay<T>, 'frames'>[]): T[] {
  return days.flatMap((day) => day.frames)
}

/** The match key one step from `key` in reel order (+1 = next/older, −1 = previous/newer); null at the ends or when `key` is not on the reel. */
export function neighborKey<T extends ReelRecord>(days: Pick<ReelDay<T>, 'frames'>[], key: string, step: 1 | -1): string | null {
  const keys = flattenReel(days).map((r) => r.match_key)
  const at = keys.indexOf(key)
  if (at < 0) return null
  return keys[at + step] ?? null
}

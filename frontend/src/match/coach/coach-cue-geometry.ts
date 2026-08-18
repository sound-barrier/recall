import { parseMatchClock } from '@/match/coach/coach-notes'
import { parseGameLengthMinutes } from '@/match/match-time-helpers'
import type { CoachMoment } from '@/match/coach/coach-moments'

/**
 * Where a cue sits on the strip, and whether its clock can be believed.
 *
 * Separate from coach-moments because the two answer to different callers: the
 * store needs the moment's SHAPE (is it savable, what goes on the wire) on
 * every app boot, while this is the layout math only the film room's strip
 * runs. Together in one module they rode the eager graph into every user's
 * first paint, including the ones who never coach anybody.
 */

/** Seconds into the match, or null when the clock is not one. */
export function clockSeconds(clock: string): number | null {
  const normalized = parseMatchClock(clock)
  if (normalized === null) return null
  const [m, s] = normalized.split(':')
  return Number(m) * 60 + Number(s)
}

/**
 * Order the strip reads in: down the match, ties broken by the order the coach
 * wrote them.
 *
 * By SECONDS, not by the string — "10:00" sorts before "9:00" lexically, and a
 * review that reads out of order is worse than one that reads in a pile. A
 * moment whose clock cannot be read sorts FIRST rather than last: the reader
 * should meet it, not find it buried at the bottom.
 */
export function sortMoments(moments: readonly CoachMoment[]): CoachMoment[] {
  return moments.map((m, i) => ({ m, i })).sort((a, b) => {
    const at = clockSeconds(a.m.matchClock) ?? -1
    const bt = clockSeconds(b.m.matchClock) ?? -1
    return at === bt ? a.i - b.i : at - bt
  }).map((x) => x.m)
}

/** The match's runtime in seconds, or null when no capture reported one. */
export function matchSeconds(gameLength: string | null | undefined): number | null {
  const minutes = parseGameLengthMinutes(gameLength ?? '')
  return minutes === null ? null : Math.round(minutes * 60)
}

/**
 * Where a moment sits on the rail, 0–1, or null when the strip cannot place it.
 *
 * Null rather than 0 when the match's length never parsed: `game_length` is
 * OCR-derived and frequently absent, and pinning every moment to the top of a
 * rail it cannot scale would draw a claim the data does not support. The strip
 * falls back to an evenly-spaced list in that case.
 */
export function railPosition(clock: string, gameLength: string | null | undefined): number | null {
  const total = matchSeconds(gameLength)
  const at = clockSeconds(clock)
  if (total === null || total <= 0 || at === null) return null
  return Math.min(1, at / total)
}

/**
 * Whether a stamp lands past the end of the match.
 *
 * A WARNING, never a refusal. The length comes from OCR and is missing on
 * manual matches entirely, so treating it as authority would reject good notes
 * on the app's own uncertainty — the same rule the rest of the campaign
 * follows about readings it does not have.
 */
export function isPastTheEnd(clock: string, gameLength: string | null | undefined): boolean {
  const total = matchSeconds(gameLength)
  const at = clockSeconds(clock)
  return total !== null && at !== null && at > total
}

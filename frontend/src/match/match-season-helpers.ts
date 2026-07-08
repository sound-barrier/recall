import type { MatchRecord } from '@/api-client'
import type { Season, SeasonWindow } from '@/composables/shared/useOWData'
import { matchInstantUTC, parseGameLengthMinutes } from '@/match/match-time-helpers'

// Season assignment is by START time: a match belongs to the season its start
// falls in, so a match that began before a boundary but ran past it stays in
// the prior season. Everything here compares in UTC (epoch ms) — the canonical
// played_at_utc and the season boundaries are both UTC, so there's no timezone
// conversion; local rendering is display-only.

// matchStartUTC returns the match's START instant as epoch ms: the canonical
// end instant (matchInstantUTC) minus its game_length. game_length is often
// absent (non-SUMMARY captures) — then the end instant is used as-is (the
// coarsest safe placement). null when no instant is derivable at all.
export function matchStartUTC(rec: Pick<MatchRecord, 'match_key' | 'data'>): number | null {
  const iso = matchInstantUTC(rec)
  if (!iso) return null
  const endMs = Date.parse(iso)
  if (Number.isNaN(endMs)) return null
  const lengthMin = parseGameLengthMinutes(rec.data?.game_length)
  return lengthMin == null ? endMs : endMs - lengthMin * 60_000
}

// inSeasonWindow reports whether a start instant falls in the half-open
// [startMs, endMs) window — a start exactly at a boundary belongs to the NEW
// season (the window that begins there).
export function inSeasonWindow(startMs: number, w: SeasonWindow): boolean {
  return startMs >= w.startMs && startMs < w.endMs
}

// seasonForMatch returns the season a match belongs to (by start time), or null
// when the match has no derivable time or falls outside every window.
export function seasonForMatch(
  rec: Pick<MatchRecord, 'match_key' | 'data'>,
  seasons: Season[],
): Season | null {
  const startMs = matchStartUTC(rec)
  if (startMs == null) return null
  for (const s of seasons) {
    const startBound = Date.parse(s.start)
    const endBound = Date.parse(s.end)
    if (Number.isNaN(startBound) || Number.isNaN(endBound)) continue
    if (inSeasonWindow(startMs, { startMs: startBound, endMs: endBound })) return s
  }
  return null
}

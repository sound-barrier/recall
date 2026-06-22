// Date / time formatters used across the dossier, leaf rows, detail
// panel, source-file list, and calendar settings. All formatters
// fall back to '—' or '' on null / unparseable inputs so the
// templates never have to special-case missing data.

import type { MatchRecord } from '@/api-client'

// Single source of truth for month-name rendering. Shared with
// match-group-helpers.ts (the grouping tree's UPPER + SHORT
// variants derive from this list).
export const MONTHS_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export const WEEKDAYS_FULL = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
] as const

// Locale preference for "what day starts a week" — any day 0-6 per
// JS Date.getDay() (0=Sun … 6=Sat). Threaded through the grouping
// helpers + the matches view's "Week of <date>" labels so US users
// see Sun-anchored weeks, ISO-8601 users see Mon-anchored, and
// Middle-East / cultural Friday- or Saturday-anchored weeks all
// work. Stored via useWeekStart; pure callers pass it explicitly.
export type WeekStart = 0 | 1 | 2 | 3 | 4 | 5 | 6

// formatHourMinute formats a 24-hour h/m pair as "9:08pm" / "12:30am".
// Shared by fmtTime (parses parser HH:MM strings) and formatParsedAt
// (reads Date.getHours / getMinutes) — the AM/PM 12-hour conversion
// used to be inlined identically in both.
function formatHourMinute(h: number, m: number): string {
  const suffix = h >= 12 ? 'pm' : 'am'
  const hr12 = h % 12 === 0 ? 12 : h % 12
  return `${hr12}:${String(m).padStart(2, '0')}${suffix}`
}

// matchTime returns a sortable string for a record. Prefers SUMMARY's
// date + finished_at (most accurate); falls back to the match_key
// prefix (set from the earliest screenshot's filename) when SUMMARY
// isn't present.
export function matchTime(rec: Pick<MatchRecord, 'match_key' | 'data'>): string {
  const d = rec.data ?? {}
  if (d.date && d.finished_at) return `${d.date}T${d.finished_at}`
  // match_key uses `-` for both date and time separators (URL-safe
  // — colons would have to be percent-encoded for the per-match
  // routes). The display timestamp the rest of the app expects is
  // ISO-extended with colons in the time portion, so rewrite the
  // captured time group's dashes back to colons on the way out.
  const m = (rec.match_key ?? '').match(/^match-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})/)
  if (!m) return ''
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}`
}

// Lightweight relative-time formatter for the "Last run" hint.
// Uses vi.setSystemTime() in tests to control Date.now().
export function formatRelativeTime(ms: number | null | undefined): string {
  if (!ms) return ''
  const diff = Date.now() - ms
  if (diff < 0) return 'just now'
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) {
    const m = Math.floor(diff / 60_000)
    return m === 1 ? '1 minute ago' : `${m} minutes ago`
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000)
    return h === 1 ? '1 hour ago' : `${h} hours ago`
  }
  const d = Math.floor(diff / 86_400_000)
  return d === 1 ? 'yesterday' : `${d} days ago`
}

// Parse an OW client "game_length" string (e.g. "11:25") into total
// minutes (fractional). Returns null when the string is missing or
// doesn't match the MM:SS / M:SS / H:MM:SS shape — callers must treat
// null as "unknown" rather than 0 so they don't fail a minutes-played
// threshold purely because the game-length field is absent.
export function parseGameLengthMinutes(s: string | null | undefined): number | null {
  if (!s) return null
  const parts = s.split(':').map(p => Number(p))
  if (parts.some(n => !Number.isFinite(n))) return null
  if (parts.length === 2) {
    const [m, sec] = parts as [number, number]
    if (m < 0 || sec < 0) return null
    return m + sec / 60
  }
  if (parts.length === 3) {
    const [h, m, sec] = parts as [number, number, number]
    if (h < 0 || m < 0 || sec < 0) return null
    return h * 60 + m + sec / 60
  }
  return null
}

// Round a fractional-minutes value (the shape parseGameLengthMinutes
// returns) back into a "MM:SS" display string. Used by the
// aggregate-stats strip to render the average match length.
// Negative or non-finite inputs render as "—".
export function formatMinutesAsClock(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—'
  const totalSeconds = Math.round(minutes * 60)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Render a play-time total (in minutes, possibly fractional) as a
// compact "Xh Ymin" / "Ymin" string. Used by the dossier's Top heroes
// breakdown to show summed time per hero alongside the share %.
// Rounds to the nearest whole minute; sub-minute totals collapse to
// "0min" rather than "—" because the field is well-defined at zero.
// Negative / non-finite inputs render as "—" (same convention as
// formatMinutesAsClock).
export function formatPlayMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return '—'
  const total = Math.round(minutes)
  const h = Math.floor(total / 60)
  const m = total % 60
  if (h === 0) return `${m}min`
  return `${h}h${m}min`
}

// Returns the earliest `date + finished_at` timestamp across all records
// that carry both fields, formatted as YYYY-MM-DDTHH:MM (for <input
// type="datetime-local"> min attributes). Returns '' when none qualify.
export function computeEarliestMatchDateTime(recs: Pick<MatchRecord, 'data'>[]): string {
  let earliest: string | null = null
  for (const r of recs) {
    const d = r.data
    if (!d?.date || !d?.finished_at) continue
    const t = `${d.date}T${d.finished_at}`
    if (!earliest || t < earliest) earliest = t
  }
  return earliest ?? ''
}

// Format the match's date + end time for the card header. Parser
// stores date as YYYY-MM-DD and finished_at as 24-hour HH:MM; the
// Wails UI prefers a friendlier `May 9, 2026 @ 9:08pm` rendering.
export function fmtTime(rec: Pick<MatchRecord, 'data'>): string {
  const d = rec.data ?? {}
  if (!d.date && !d.finished_at) return ''

  // Date portion: "May 9, 2026". Full month names; day not zero-padded.
  let datePart = ''
  if (d.date) {
    const [yStr = '', moStr = '', dayStr = ''] = d.date.split('-')
    const y = Number(yStr), mo = Number(moStr), day = Number(dayStr)
    if (!Number.isNaN(y) && !Number.isNaN(mo) && !Number.isNaN(day) && mo >= 1 && mo <= 12) {
      datePart = `${MONTHS_FULL[mo - 1]!} ${day}, ${y}`
    }
  }

  // Time portion: "9:08pm". Falls back to raw HH:MM if parsing fails.
  let timePart = ''
  if (d.finished_at) {
    const [hStr = '', mStr = ''] = d.finished_at.split(':')
    const h = Number(hStr), m = Number(mStr)
    timePart = (Number.isNaN(h) || Number.isNaN(m)) ? d.finished_at : formatHourMinute(h, m)
  }

  if (datePart && timePart) return `${datePart} @ ${timePart}`
  return datePart || timePart
}

// formatParsedAt renders an ISO8601 timestamp (the shape stored in
// MatchRecord.parsed_at / MatchRecord.source_parsed_at[*]) as a
// friendly "May 9, 2026 @ 9:08pm" string matching fmtTime's
// aesthetic. Returns '' for empty / nullish input; returns the raw
// string if it doesn't parse as a Date so display never crashes.
// Renders in the user's local timezone (parsed_at is stored in UTC
// but shown wherever the user is).
export function formatParsedAt(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso // unparseable — show raw
  const datePart = `${MONTHS_FULL[d.getMonth()]!} ${d.getDate()}, ${d.getFullYear()}`
  const timePart = formatHourMinute(d.getHours(), d.getMinutes())
  return `${datePart} @ ${timePart}`
}

// formatIgnoredAt — short local form for the suppress-list timestamps, e.g.
// "Jun 5, 12:34 PM" (no year). Empty string for a blank/unparseable value.
export function formatIgnoredAt(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// monthDateRange maps a 'YYYY-MM' month key to its full calendar span as
// YYYY-MM-DD strings — first day to last day, handling 30/31-day months and
// leap-year February. Drives the campaign-log heatmap's "pick the whole month".
export function monthDateRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  const last = new Date(y!, m!, 0).getDate() // day 0 of next month = this month's last day
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

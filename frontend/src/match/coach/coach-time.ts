// The player's clock, for the coaching session. A coach reviews a bundle
// exported from another timezone, so every time shown in the Film Room is
// the PLAYER's naive scoreboard clock (`data.date` + `data.finished_at`),
// labeled as such — never `played_at_utc` rendered in the coach's zone,
// which is what the app's default display helpers (fmtTime, formatRowDate,
// formatFinishedAt) do and what would shift a 21:14 match to a different
// hour and often a different day.

import type { MatchRecord } from '@/api-client'
import { MONTHS_FULL, WEEKDAYS_FULL } from '@/match/match-time-helpers'

type ClockSource = Pick<MatchRecord, 'match_key' | 'data'>

const MONTHS_SHORT = MONTHS_FULL.map((m) => m.slice(0, 3))
const WEEKDAYS_SHORT = WEEKDAYS_FULL.map((d) => d.slice(0, 3))

// Same fallback matchTime() uses when SUMMARY fields are absent: the match
// key carries the earliest screenshot's capture timestamp, `-`-separated
// throughout (URL-safe).
const CAPTURE_KEY = /^match-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-\d{2}/

export function captureParts(matchKey: string | undefined): { date: string; time: string } | null {
  const m = (matchKey ?? '').match(CAPTURE_KEY)
  if (!m) return null
  return { date: m[1]!, time: `${m[2]!}:${m[3]!}` }
}

function padClock(raw: string): string {
  const [h = '', m = ''] = raw.split(':')
  if (h === '' || m === '' || Number.isNaN(Number(h)) || Number.isNaN(Number(m))) return raw
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`
}

/** The player's naive finish time as 24-hour "HH:MM"; '' when the record carries no clock at all. */
export function playerClockTime(rec: ClockSource): string {
  const finishedAt = rec.data?.finished_at
  if (finishedAt) return padClock(finishedAt)
  return captureParts(rec.match_key)?.time ?? ''
}

/** The player's naive day as YYYY-MM-DD (the reel's grouping key); '' when undated. */
export function playerClockDayKey(rec: ClockSource): string {
  return rec.data?.date || captureParts(rec.match_key)?.date || ''
}

interface NaiveDay {
  year: number
  month: number
  day: number
  weekday: number
}

// UTC construction on purpose: a `new Date('YYYY-MM-DD')` is UTC midnight,
// and reading it back with local getters rolls the day back for a viewer
// west of Greenwich. Reading with UTC getters keeps the naive day intact.
function parseNaiveDay(dayKey: string): NaiveDay | null {
  const m = dayKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const dt = new Date(Date.UTC(year, month - 1, day))
  if (Number.isNaN(dt.getTime())) return null
  return { year, month, day, weekday: dt.getUTCDay() }
}

// "Aug 8", or "Aug 8, 2025" outside the current calendar year — the same
// convention formatRowDate uses so a multi-year corpus reads in order.
function naiveDateLabel(parsed: NaiveDay): string {
  const label = `${MONTHS_SHORT[parsed.month - 1]!} ${parsed.day}`
  return parsed.year === new Date().getFullYear() ? label : `${label}, ${parsed.year}`
}

/** The player's naive day as "Aug 8" ("Aug 8, 2025" outside this year); '' when undated. */
export function playerClockDate(rec: ClockSource): string {
  const parsed = parseNaiveDay(playerClockDayKey(rec))
  return parsed ? naiveDateLabel(parsed) : ''
}

/** A reel day key rendered as "Fri · Aug 8" (weekday of the naive date); '' for an empty or malformed key. */
export function formatPlayerDay(dayKey: string): string {
  const parsed = parseNaiveDay(dayKey)
  if (!parsed) return ''
  return `${WEEKDAYS_SHORT[parsed.weekday]!} · ${naiveDateLabel(parsed)}`
}

/**
 * The VIEWER's calendar day for a UTC instant.
 *
 * `exported_at` and `last_note_at` are instants; rendering their UTC date would
 * put a share made at 19:00 in UTC-8 on tomorrow's row. Reading the local
 * components first is what keeps "today" meaning today.
 */
export function localDay(rfc3339: string): string {
  const d = new Date(rfc3339)
  if (Number.isNaN(d.getTime())) return rfc3339.slice(0, 10)
  const pad = (n: number) => String(n).padStart(2, '0')
  return formatPlayerDay(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`)
}

/**
 * A match key rendered as a label: a dated capture key reads as its
 * player-day, a replay key reads as its code, anything else as itself.
 * The coach's store keeps only notes — the loaned matches leave with
 * their sessions — so on every surface listing stored notes, the key is
 * all there is to say where one belongs.
 */
export function matchKeyLabel(matchKey: string): string {
  const captured = captureParts(matchKey)
  if (captured) return formatPlayerDay(captured.date)
  const replay = /^replay-(.+)$/.exec(matchKey)
  return replay?.[1] ?? matchKey
}


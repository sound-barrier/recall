import { WEEKDAYS_FULL, monthDateRange } from '@/match/match-time-helpers'
import type { Season } from '@/composables/shared/useOWData'

/**
 * Natural-language date phrases for the narrow's time scope.
 *
 * The governing rule is that this DECLINES far more than it accepts. A date
 * filter that silently guesses wrong is worse than one that does nothing: the
 * user sees a filtered set, believes it means what they asked for, and reads
 * conclusions off it. Every phrase below has exactly one defensible reading;
 * anything else returns null and leaves the pickers untouched.
 *
 * Ranges are NAIVE-LOCAL calendar dates (YYYY-MM-DD), never UTC instants,
 * because that is the axis the narrow's date predicate compares on — it slices
 * a record's naive stamp to ten characters and compares strings. Producing a
 * UTC instant here would shift every boundary by the viewer's offset and drop
 * or admit a day at each end.
 */

export type DatePhrase =
  | { kind: 'range'; from: string; to: string; label: string }
  | { kind: 'season'; name: string; label: string }

export interface PhraseDeps {
  now: Date
  // 0 = Sunday .. 6 = Saturday. The user's own week-start preference, because
  // "last week" is a calendar claim and calendars disagree about where a week
  // begins.
  weekStartsOn: number
  seasons: readonly Season[]
}

function ymd(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}

// Start of the calendar week containing `d`, honoring the user's week start.
function weekStart(d: Date, startsOn: number): Date {
  const back = (d.getDay() - startsOn + 7) % 7
  return addDays(d, -back)
}

function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// "last week" means the previous CALENDAR week, not a rolling seven days. The
// rolling reading is already a chip (7d) one click away, so duplicating it here
// would add a second way to say the same thing while leaving the calendar
// question — "how did I do last week?" — still unanswerable.
function calendarRanges(deps: PhraseDeps): Record<string, DatePhrase> {
  const { now, weekStartsOn } = deps
  const thisWeek = weekStart(now, weekStartsOn)
  const lastWeek = addDays(thisWeek, -7)
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return {
    'today': { kind: 'range', from: ymd(now), to: ymd(now), label: 'Today' },
    'yesterday': (() => {
      const y = addDays(now, -1)
      return { kind: 'range', from: ymd(y), to: ymd(y), label: 'Yesterday' }
    })(),
    'this week': { kind: 'range', from: ymd(thisWeek), to: ymd(now), label: 'This week' },
    'last week': {
      kind: 'range', from: ymd(lastWeek), to: ymd(addDays(thisWeek, -1)), label: 'Last week',
    },
    'this month': { kind: 'range', from: `${monthKey(now)}-01`, to: ymd(now), label: 'This month' },
    'last month': (() => {
      const { from, to } = monthDateRange(monthKey(lastMonthDate))
      return { kind: 'range', from, to, label: 'Last month' }
    })(),
  }
}

// "since <weekday>" reaches back to the most recent PAST occurrence. Saying it
// on a Tuesday and meaning next Tuesday is not a reading anyone intends, and
// a bare weekday with no "since" is genuinely ambiguous — it could mean that
// one day, or every one of them — so only the prefixed form is accepted.
function sinceWeekday(phrase: string, now: Date): DatePhrase | null {
  const m = /^since\s+([a-z]+)$/.exec(phrase)
  if (!m) return null
  const idx = WEEKDAYS_FULL.findIndex((d) => d.toLowerCase() === m[1])
  if (idx < 0) return null
  const back = (now.getDay() - idx + 7) % 7 || 7
  const from = addDays(now, -back)
  return { kind: 'range', from: ymd(from), to: ymd(now), label: `Since ${WEEKDAYS_FULL[idx]}` }
}

// "this season" / "last season" are a LOOKUP, not a parse, and they resolve to
// the season NAME rather than a date range. The season filter compares a
// match's UTC start against the season window; flattening that to local
// calendar dates would mis-place matches within hours of a boundary, and would
// also freeze the answer if the season table were later corrected.
function seasonPhrase(phrase: string, deps: PhraseDeps): DatePhrase | null {
  if (phrase !== 'this season' && phrase !== 'last season') return null
  const ms = deps.now.getTime()
  const sorted = [...deps.seasons]
    .filter((s) => !!s.start)
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const currentIdx = sorted.findIndex(
    (s) => Date.parse(s.start) <= ms && (!s.end || ms < Date.parse(s.end)),
  )
  if (currentIdx < 0) return null
  const wanted = phrase === 'this season' ? currentIdx : currentIdx - 1
  const season = sorted[wanted]
  if (!season) return null
  return { kind: 'season', name: season.name, label: season.name }
}

/**
 * Parse a phrase, or decline.
 *
 * Returns null for anything it cannot read with confidence, including the empty
 * string. Callers leave the existing filter untouched on null — a decline must
 * never clear what the user already set.
 */
export function parseDatePhrase(input: string, deps: PhraseDeps): DatePhrase | null {
  const phrase = input.trim().toLowerCase().replace(/\s+/g, ' ')
  if (phrase === '') return null

  const calendar = calendarRanges(deps)[phrase]
  if (calendar) return calendar

  return seasonPhrase(phrase, deps) ?? sinceWeekday(phrase, deps.now)
}

/** Every phrase the parser accepts, for the input's own hint text. */
export const SUPPORTED_PHRASES = [
  'today', 'yesterday', 'this week', 'last week', 'this month', 'last month',
  'this season', 'last season', 'since <weekday>',
] as const

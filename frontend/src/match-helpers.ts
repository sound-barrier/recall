// Pure helpers extracted from App.vue so they can be unit-tested
// independently. Anything UI-stateful (reactive refs, computed) stays
// in App.vue; everything here takes plain inputs and returns plain
// outputs.

import type { MatchRecord, HeroPlay, ScreenshotType } from './api'

export interface ScreenshotSlot {
  key: ScreenshotType
  label: string
  required: boolean
  present: boolean
  hint: string
  missing: string
}

// The four canonical OW post-match screenshot types our parser
// classifies into. Order is workflow order: SUMMARY (post-match
// summary tab) → TEAMS (post-match scoreboard / in-game scoreboard) →
// PERSONAL (per-hero stats tab) → RANK (competitive rank screen).
export const SCREENSHOT_TYPES: ScreenshotType[] = ['summary', 'scoreboard', 'personal', 'rank']

// Pretty label for a screenshot-type value. "scoreboard" is rendered
// as "TEAMS" everywhere else in the app so its filter chip matches.
export function sshotTypeLabel(t: string | null | undefined): string {
  if (t === 'scoreboard') return 'TEAMS'
  return (t || 'unknown').toUpperCase()
}

// Look up the parser-assigned type for a specific source file on a
// record. Returns '' (empty string) for files parsed before per-file
// type tracking landed — the UI renders a "?" chip in that case.
export function sourceType(
  rec: Pick<MatchRecord, 'source_types'> | null | undefined,
  filename: string,
): ScreenshotType | '' {
  return rec?.source_types?.[filename] ?? ''
}

// Infer which screenshot types were parsed for a record. Drives the
// slot-chip row at the top of the Source Screenshots section and the
// missing-data explainer beneath the file list.
//
// `required: true` means a complete match needs that screenshot
// (SUMMARY / TEAMS / PERSONAL). `required: false` is RANK — useful
// but not strictly needed.
//
// When the row carries a stored source_types map (populated at parse
// time from each individual file's classifier), that map is the
// source of truth — a chip is PRESENT iff at least one source file
// is tagged with that type. For pre-migration rows (no source_types)
// we fall back to field-presence inference, which is fuzzier —
// read-time inferences like inferResultFromRank can falsely light up
// SUMMARY, and a scoreboard-only row will light up PERSONAL because
// the scoreboard's right-panel stats are stored in
// HeroesPlayed[*].Stats.
export function detectScreenshotSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  const d = rec.data ?? {}
  const hp = Array.isArray(d.heroes_played) ? d.heroes_played : []
  const storedTypes = rec.source_types
    ? new Set(Object.values(rec.source_types).filter(Boolean))
    : null
  const combatTotal = (d.eliminations ?? 0) + (d.assists ?? 0) + (d.deaths ?? 0) +
                      (d.damage ?? 0) + (d.healing ?? 0) + (d.mitigation ?? 0)
  const presence = (key: ScreenshotType, fallback: boolean): boolean =>
    storedTypes ? storedTypes.has(key) : fallback
  return [
    {
      key: 'summary',
      label: 'SUMMARY',
      required: true,
      present: presence('summary',
        !!(d.final_score || d.date || d.finished_at || d.game_length ||
           d.type || d.mode ||
           hp.some(h => h.percent_played || h.play_time))),
      hint: 'Post-match SUMMARY tab — match result, final score, date, game length',
      missing: 'match result, final score, date & time, game length',
    },
    {
      key: 'scoreboard',
      label: 'TEAMS',
      required: true,
      present: presence('scoreboard', combatTotal > 0),
      hint: 'TEAMS scoreboard (in-game or post-match) — E/A/D, damage, healing, mitigation',
      missing: 'eliminations, assists, deaths, damage, healing, mitigation',
    },
    {
      key: 'personal',
      label: 'PERSONAL',
      required: true,
      present: presence('personal',
        hp.some(h => h.stats && Object.keys(h.stats).length > 0) && combatTotal === 0),
      hint: 'Post-match PERSONAL tab — per-hero detailed stats (accuracy, ult charges, role-specific cards)',
      missing: 'per-hero detailed stats (accuracy, ult charges, role-specific cards)',
    },
    {
      key: 'rank',
      label: 'RANK',
      required: false,
      present: presence('rank',
        !!(d.rank || d.level || (Array.isArray(d.sr) && d.sr.length > 0))),
      hint: 'Competitive rank screen — SR, rank tier, rank change. Optional but recommended for ranked matches.',
      missing: 'SR / rank tier / rank change',
    },
  ]
}

export function missingRequiredSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  return detectScreenshotSlots(rec).filter(s => s.required && !s.present)
}

export function missingOptionalSlots(rec: Pick<MatchRecord, 'data' | 'source_types'>): ScreenshotSlot[] {
  return detectScreenshotSlots(rec).filter(s => !s.required && !s.present)
}

// Heroes need a custom collector — uniqueValues('hero') would only
// pick up the primary/most-played hero on each row. Returns the list
// sorted by percent_played descending. Multi-hero matches (with a
// SUMMARY or PERSONAL screenshot) get the full list; a fallback for
// matches that only have the scoreboard parsed returns the single
// primary hero so the title isn't empty.
export function heroesForHeader(rec: Pick<MatchRecord, 'data'>): HeroPlay[] {
  const list = rec.data?.heroes_played
  if (Array.isArray(list) && list.length > 0) {
    return [...list].sort((a, b) => (b.percent_played ?? 0) - (a.percent_played ?? 0))
  }
  if (rec.data?.hero) return [{ hero: rec.data.hero, percent_played: 0 }]
  return []
}

// matchTime returns a sortable string for a record. Prefers SUMMARY's
// date + finished_at (most accurate); falls back to the match_key
// prefix (set from the earliest screenshot's filename) when SUMMARY
// isn't present.
export function matchTime(rec: Pick<MatchRecord, 'match_key' | 'data'>): string {
  const d = rec.data ?? {}
  if (d.date && d.finished_at) return `${d.date}T${d.finished_at}`
  const m = (rec.match_key ?? '').match(/^match:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})/)
  return m ? m[1]! : ''
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

// Builds the URL for the screenshot image server route.
export function screenshotURL(filename: string): string {
  return `/_screenshot/${encodeURIComponent(filename)}`
}

// ───────────────────────────────────────────────────────────────────
// W/L/D tally + Month → Week → Day grouping
//
// Once a user has played hundreds of games spanning many months the
// flat card list becomes untenable. The grouping helpers below let the
// UI render a three-level outline (MONTH → Week of Mon-Sun → Day) with
// each level carrying its own W/L/D summary that's derivable from the
// already-filtered record list — so the sub-totals automatically
// respect whatever filters the user has applied above.
// ───────────────────────────────────────────────────────────────────

export interface WLDTally {
  w: number
  l: number
  d: number
}

// 'unknown' is the triage bucket for records that pass the matched-view
// filter (have a map) but lack a parseable data.date. They can't be
// placed in the Month → Week → Day tree, but the user still needs to see
// them — so they get a single pinned-at-bottom group with no children,
// just the records.
type MatchGroupLevel = 'year' | 'month' | 'week' | 'day' | 'unknown'

// GroupableRecord is the minimal shape groupMatchesByMonthWeekDay needs:
// a date, a finish time, an optional result, and an optional match_key
// (used for stable Vue keys when records inside a day are otherwise
// indistinguishable). Keeping the parameter type permissive — and the
// `result` deliberately as a free-form string — matches the
// Law-of-Demeter pattern of tallyWLD and computeEarliestMatchDateTime:
// each helper reads only the fields it touches. Production callers
// pass full MatchRecord[]; tests can author terse fixtures without
// satisfying every field of the OpenAPI-generated type.
export interface GroupableRecord {
  match_key?: string | null
  data?: {
    date?: string | null
    finished_at?: string | null
    result?: string | null
  } | null
}

export interface MatchGroup<R extends GroupableRecord = MatchRecord> {
  key: string
  level: MatchGroupLevel
  label: string
  tally: WLDTally
  /** Set on month + week levels. */
  children?: MatchGroup<R>[]
  /** Set on the leaf (day) level. */
  matches?: R[]
}

// tallyWLD counts wins / losses / draws case-insensitively. Records
// whose `data.result` is empty, missing, or anything other than
// victory/defeat/draw are silently ignored — partial rolls are fine
// (W+L+D ≤ length).
export function tallyWLD(
  records: { data?: { result?: string | null } | null }[],
): WLDTally {
  let w = 0
  let l = 0
  let d = 0
  for (const r of records) {
    const result = (r.data?.result ?? '').toLowerCase()
    if (result === 'victory') w++
    else if (result === 'defeat') l++
    else if (result === 'draw') d++
  }
  return { w, l, d }
}

const MONTHS_FULL_UPPER = [
  'JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE',
  'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER',
]
const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]
const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// All date math runs in UTC so that, e.g., parsing "2026-05-10" and
// rendering "May 10" doesn't drift in timezones behind UTC (US/Pacific
// would turn the UTC midnight back into May 9 if we used local-time
// Date construction).
function parseISODateUTC(date: string): Date | null {
  const m = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (Number.isNaN(y) || Number.isNaN(mo) || Number.isNaN(d)) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  return Number.isNaN(dt.getTime()) ? null : dt
}

// Locale preference for "what day starts a week". Threaded through the
// grouping helpers + the matches view's "Week of <date>" labels so a
// US-default user sees Sun→Sat weeks and a European user can opt into
// Mon→Sun via Settings. Stored at the React-side via useWeekStart;
// pure callers pass it explicitly.
export type WeekStart = 'sunday' | 'monday'

// Shift `date` back to the most recent week-start day (inclusive).
// Sunday-start: Sun=0, Mon=-1, Tue=-2, … Sat=-6.
// Monday-start: Sun=-6, Mon=0, Tue=-1, … Sat=-5.
function weekAnchorUTC(date: Date, weekStart: WeekStart): Date {
  const d = new Date(date.getTime())
  const wd = d.getUTCDay()
  const diff = weekStart === 'sunday'
    ? -wd
    : wd === 0 ? -6 : 1 - wd
  d.setUTCDate(d.getUTCDate() + diff)
  return d
}

function isoDateKey(d: Date): string {
  const y = d.getUTCFullYear()
  const mo = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${mo}-${day}`
}

function monthLabel(d: Date): string {
  return `${MONTHS_FULL_UPPER[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}
function weekLabel(anchor: Date): string {
  return `Week of ${MONTHS_SHORT[anchor.getUTCMonth()]} ${anchor.getUTCDate()}`
}
function dayLabel(d: Date): string {
  return `${WEEKDAYS_SHORT[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
}

function sumTally(groups: { tally: WLDTally }[]): WLDTally {
  return groups.reduce(
    (acc, g) => ({ w: acc.w + g.tally.w, l: acc.l + g.tally.l, d: acc.d + g.tally.d }),
    { w: 0, l: 0, d: 0 },
  )
}

// groupMatchesByMonthWeekDay buckets a flat (already-filtered) list of
// records into Month → Week → Day, with each level carrying its own
// W/L/D tally. Records without a parseable data.date are dropped — the
// match_key timestamp fallback isn't used here because we only want to
// group by the authoritative game-reported date.
//
// Weeks are anchored on the first day of the calendar week the date
// falls in. The anchor day is configurable via options.weekStart
// (default 'sunday', the US default). A week straddling a month
// boundary appears in both month buckets; each bucket only contains
// the day(s) that belong to its own month.
//
// sortDir orders all three levels (newest-first under 'desc', oldest-
// first under 'asc'), including the records inside each day.
export function groupMatchesByMonthWeekDay<R extends GroupableRecord>(
  records: R[],
  sortDir: 'asc' | 'desc',
  options: { weekStart?: WeekStart } = {},
): MatchGroup<R>[] {
  const weekStart: WeekStart = options.weekStart ?? 'sunday'
  type DayBucket = { date: Date; recs: R[] }
  type WeekBucket = { anchor: Date; days: Map<string, DayBucket> }
  type MonthBucket = { firstOfMonth: Date; weeks: Map<string, WeekBucket> }

  const months = new Map<string, MonthBucket>()
  // Records that pass the matched-view filter but lack a parseable
  // date — captured here and surfaced as a single "UNKNOWN DATE"
  // group at the bottom of the tree once the dated tree is built.
  const undated: R[] = []

  for (const r of records) {
    const dateStr = r.data?.date
    if (!dateStr) { undated.push(r); continue }
    const date = parseISODateUTC(dateStr)
    if (!date) { undated.push(r); continue }

    const monthKey = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
    let month = months.get(monthKey)
    if (!month) {
      month = {
        firstOfMonth: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)),
        weeks: new Map(),
      }
      months.set(monthKey, month)
    }

    const anchor = weekAnchorUTC(date, weekStart)
    const weekKey = isoDateKey(anchor)
    let week = month.weeks.get(weekKey)
    if (!week) {
      week = { anchor, days: new Map() }
      month.weeks.set(weekKey, week)
    }

    const dayKey = isoDateKey(date)
    let day = week.days.get(dayKey)
    if (!day) {
      day = { date, recs: [] }
      week.days.set(dayKey, day)
    }
    day.recs.push(r)
  }

  if (months.size === 0 && undated.length === 0) return []

  const dir = sortDir === 'asc' ? 1 : -1
  const byKey = (a: { key: string }, b: { key: string }) =>
    a.key < b.key ? -1 * dir : a.key > b.key ? 1 * dir : 0
  const cmpStr = (a: string, b: string) =>
    a < b ? -1 * dir : a > b ? 1 * dir : 0

  let tree: MatchGroup<R>[] = []
  // Year tag for each month group — populated alongside the push so
  // the year-wrapping step below can regroup without re-parsing keys.
  const monthYears = new Map<MatchGroup<R>, number>()
  for (const [monthKey, month] of months) {
    const weekGroups: MatchGroup<R>[] = []
    for (const [weekKey, week] of month.weeks) {
      const dayGroups: MatchGroup<R>[] = []
      for (const [dayKey, day] of week.days) {
        const sortedRecs = [...day.recs].sort((a, b) =>
          cmpStr(a.data?.finished_at ?? '', b.data?.finished_at ?? ''),
        )
        dayGroups.push({
          key: `day:${dayKey}`,
          level: 'day',
          label: dayLabel(day.date),
          tally: tallyWLD(sortedRecs),
          matches: sortedRecs,
        })
      }
      dayGroups.sort(byKey)
      weekGroups.push({
        key: `week:${weekKey}`,
        level: 'week',
        label: weekLabel(week.anchor),
        tally: sumTally(dayGroups),
        children: dayGroups,
      })
    }
    weekGroups.sort(byKey)
    const monthGroup: MatchGroup<R> = {
      key: `month:${monthKey}`,
      level: 'month',
      label: monthLabel(month.firstOfMonth),
      tally: sumTally(weekGroups),
      children: weekGroups,
    }
    tree.push(monthGroup)
    // Track the year alongside each month so the year-wrapping step
    // below doesn't have to re-parse keys or labels.
    monthYears.set(monthGroup, month.firstOfMonth.getUTCFullYear())
  }
  tree.sort(byKey)

  // Year wrapping. When records span multiple calendar years, regroup
  // the flat month list into Year buckets — adds a Year header on top
  // of the existing Month → Week → Day tree. Single-year datasets stay
  // month-rooted (no Year header) so users with a few months of data
  // don't see a noise level in the outline.
  const yearsSet = new Set([...monthYears.values()])
  if (yearsSet.size > 1) {
    const yearBuckets = new Map<number, MatchGroup<R>[]>()
    for (const m of tree) {
      const y = monthYears.get(m)!
      const list = yearBuckets.get(y) ?? []
      list.push(m)
      yearBuckets.set(y, list)
    }
    tree = []
    for (const [year, monthList] of yearBuckets) {
      tree.push({
        key: `year:${year}`,
        level: 'year',
        label: String(year),
        tally: sumTally(monthList),
        children: monthList,
      })
    }
    tree.sort(byKey)
  }

  // UNKNOWN DATE bucket — appended AFTER the dated tree sort so it
  // sits at the bottom of the array irrespective of sortDir. Records
  // are sorted by match_key for a stable order (sortDir doesn't apply
  // — there's no meaningful chronology to flip).
  if (undated.length > 0) {
    const sortedUndated = [...undated].sort((a, b) =>
      (a.match_key ?? '') < (b.match_key ?? '') ? -1
        : (a.match_key ?? '') > (b.match_key ?? '') ? 1
        : 0,
    )
    tree.push({
      key: 'unknown',
      level: 'unknown',
      label: 'UNKNOWN DATE',
      tally: tallyWLD(sortedUndated),
      matches: sortedUndated,
    })
  }

  return tree
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
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  let datePart = ''
  if (d.date) {
    const [yStr = '', moStr = '', dayStr = ''] = d.date.split('-')
    const y = Number(yStr), mo = Number(moStr), day = Number(dayStr)
    if (!Number.isNaN(y) && !Number.isNaN(mo) && !Number.isNaN(day) && mo >= 1 && mo <= 12) {
      datePart = `${months[mo - 1]!} ${day}, ${y}`
    }
  }

  // Time portion: "9:08pm". Falls back to raw HH:MM if parsing fails.
  let timePart = ''
  if (d.finished_at) {
    const [hStr = '', mStr = ''] = d.finished_at.split(':')
    const h = Number(hStr), m = Number(mStr)
    if (Number.isNaN(h) || Number.isNaN(m)) {
      timePart = d.finished_at
    } else {
      const suffix = h >= 12 ? 'pm' : 'am'
      let hr12 = h % 12
      if (hr12 === 0) hr12 = 12
      timePart = `${hr12}:${String(m).padStart(2, '0')}${suffix}`
    }
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
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December']
  const datePart = `${months[d.getMonth()]!} ${d.getDate()}, ${d.getFullYear()}`
  const h = d.getHours()
  const m = d.getMinutes()
  const suffix = h >= 12 ? 'pm' : 'am'
  let hr12 = h % 12
  if (hr12 === 0) hr12 = 12
  const timePart = `${hr12}:${String(m).padStart(2, '0')}${suffix}`
  return `${datePart} @ ${timePart}`
}

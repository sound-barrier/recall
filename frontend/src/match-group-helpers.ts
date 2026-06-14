// Month → Week → Day grouping for the matches view's outline. The
// grouping tree carries a W/L/D tally at every level so the user can
// scan win-rate per month / week / day at a glance.

import type { MatchRecord } from '@/api'
import { MONTHS_FULL, WEEKDAYS_FULL, type WeekStart } from '@/match-time-helpers'
import { tallyWLD, type WLDTally } from '@/match-stats-helpers'

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

const MONTHS_FULL_UPPER = MONTHS_FULL.map(m => m.toUpperCase())
const MONTHS_SHORT = MONTHS_FULL.map(m => m.slice(0, 3))

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

// Shift `date` back to the most recent week-start day (inclusive).
// (wd - weekStart + 7) % 7 = days since the most recent week-start
// for any 0-6 pair.
function weekAnchorUTC(date: Date, weekStart: WeekStart): Date {
  const d = new Date(date.getTime())
  const wd = d.getUTCDay()
  const diff = -(((wd - weekStart) + 7) % 7)
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
  return `${WEEKDAYS_FULL[d.getUTCDay()]} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCDate()}`
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
  options: { weekStart?: WeekStart; skipAnnotatedInTally?: boolean } = {},
): MatchGroup<R>[] {
  const weekStart: WeekStart = options.weekStart ?? 0
  const skipAnnotated = options.skipAnnotatedInTally === true
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
          tally: tallyWLD(sortedRecs, skipAnnotated),
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

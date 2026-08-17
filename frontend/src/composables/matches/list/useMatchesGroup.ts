import { computed, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { isEditedMatch, isManualMatch } from '@/match/match-helpers'
import { bumpTally, newTally, type WldTally } from '@/match/dossier/match-dossier-tally'
import { matchEpoch } from '@/match/trends/match-trends-helpers'
import { SESSION_GAP_HOURS } from '@/match/dossier/match-momentum-helpers'

// Sort + group-by state for the Matches workspace leaves list.
// Extracted from MatchesView so the bucketing logic has its own
// test surface — bucket boundaries (Monday-anchored weeks, YYYY-MM
// for months, etc.) are the kind of "did you handle DST?" detail
// that's much easier to verify in isolation than through the
// integrated UI.

export type GroupBy   = 'none' | 'day' | 'week' | 'month' | 'year' | 'session' | 'provenance'
export type SortOrder = 'newest' | 'oldest'

// Provenance grouping buckets in surfacing order — the user-touched
// matches (the ones worth hunting for) lead, pure OCR trails. Mirrors
// the data table's Edited / User-entered columns for the cozy/compact
// list, which has no room for them.
const PROVENANCE_SECTIONS: { key: string; header: string; match: (r: MatchRecord) => boolean }[] = [
  { key: 'ocr_edited', header: 'Edited',        match: isEditedMatch },
  { key: 'manual',     header: 'User entered',  match: isManualMatch },
  { key: 'ocr',        header: 'OCR generated',  match: (r) => !isEditedMatch(r) && !isManualMatch(r) },
]

export interface GroupedSection {
  // Stable key for keyed v-for. "all" when groupBy === 'none'; the
  // bucket's natural identifier otherwise (date string, YYYY-MM,
  // etc.).
  key: string
  // Human-readable header — null when groupBy === 'none' so the UI
  // can omit the divider row entirely.
  header: string | null
  records: MatchRecord[]
  // Session grouping only: the pre-formatted rollup line the divider
  // renders next to the header ("2W 1L · 1h 40m · avg 21/10/8").
  rollup?: string
}

function sortKey(r: MatchRecord): string {
  // Compose `date + finished_at` so multi-match days break ties by
  // time-of-day, not by parse arrival order. Falls back to
  // parsed_at for undated rows (no date) — without the date the time
  // alone isn't a meaningful sort key.
  return r.data?.date ? `${r.data.date}T${r.data.finished_at ?? ''}` : (r.parsed_at ?? '')
}

// Append the year to a short date label only when the date isn't in the
// current calendar year ("Dec 31, 2025" vs "Jun 3"), so a multi-year
// corpus's day/week headers read in chronological order rather than
// looking scrambled when same month/day collide across years.
function shortDateWithYear(d: Date, base: Intl.DateTimeFormatOptions): string {
  const opts: Intl.DateTimeFormatOptions = d.getFullYear() === new Date().getFullYear()
    ? base
    : { ...base, year: 'numeric' }
  return d.toLocaleDateString(undefined, opts)
}

function bucketFor(date: string, bucket: GroupBy): { key: string; label: string } {
  if (!date) return { key: 'no-date', label: 'No date' }
  if (bucket === 'none') return { key: date, label: '' }
  if (bucket === 'year') return { key: date.slice(0, 4), label: date.slice(0, 4) }
  if (bucket === 'month') {
    const key = date.slice(0, 7)
    const d = new Date(date + 'T00:00:00')
    const label = isNaN(d.getTime())
      ? key
      : d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
    return { key, label }
  }
  if (bucket === 'week') {
    const d = new Date(date + 'T00:00:00')
    if (isNaN(d.getTime())) return { key: date, label: date }
    // Monday-anchored week — matches the rest of the app's default
    // (useWeekStart). JS getDay returns 0 = Sunday … 6 = Saturday;
    // (day + 6) % 7 maps Sunday→6 so subtracting that gives Monday.
    const day = d.getDay()
    const monday = new Date(d)
    monday.setDate(d.getDate() - ((day + 6) % 7))
    const key = monday.toISOString().slice(0, 10)
    const label = `Week of ${shortDateWithYear(monday, { month: 'short', day: 'numeric' })}`
    return { key, label }
  }
  // day
  const d = new Date(date + 'T00:00:00')
  if (isNaN(d.getTime())) return { key: date, label: date }
  return {
    key: date,
    label: shortDateWithYear(d, { weekday: 'short', month: 'short', day: 'numeric' }),
  }
}

// sessionHeader labels a session by its day + finished-at span:
// "Sat, Jun 3 · 19:00 – 19:30". Single-match sessions show one time.
function sessionHeader(records: MatchRecord[]): string {
  const times = records
    .map((r) => ({ date: r.data?.date ?? '', at: r.data?.finished_at ?? '' }))
    .filter((t) => t.date !== '')
    .sort((a, b) => `${a.date}T${a.at}`.localeCompare(`${b.date}T${b.at}`))
  if (times.length === 0) return 'Session'
  const first = times[0]
  const last = times[times.length - 1]
  const d = new Date(first!.date + 'T00:00:00')
  const day = isNaN(d.getTime())
    ? first!.date
    : shortDateWithYear(d, { weekday: 'short', month: 'short', day: 'numeric' })
  return `${day}${sessionTimeSpan(first!.at, last!.at)}`
}

function sessionTimeSpan(firstAt: string, lastAt: string): string {
  if (firstAt && lastAt && firstAt !== lastAt) return ` · ${firstAt} – ${lastAt}`
  return firstAt ? ` · ${firstAt}` : ''
}

interface SessionStats {
  e: number
  a: number
  dth: number
  statted: number
}

function accumulateStats(s: SessionStats, r: MatchRecord): void {
  if (typeof r.data?.eliminations !== 'number') return
  s.e += r.data.eliminations
  s.a += r.data.assists ?? 0
  s.dth += r.data.deaths ?? 0
  s.statted++
}

// Draws drop out when empty so short lines stay short.
function wldLine(t: WldTally): string {
  return [`${t.w}W`, `${t.l}L`, ...(t.d > 0 ? [`${t.d}D`] : [])].join(' ')
}

// The session's wall-clock span; empty for a single placeable time.
function spanLine(epochs: number[]): string {
  if (epochs.length <= 1) return ''
  const spanMin = Math.round((Math.max(...epochs) - Math.min(...epochs)) / 60_000)
  return spanMin >= 60 ? `${Math.floor(spanMin / 60)}h ${spanMin % 60}m` : `${spanMin}m`
}

// sessionRollup pre-formats the divider's stat line: W/L/D tallies,
// the session's wall-clock span, and the average E/A/D line across
// matches that carry stats (both drop out when empty).
function sessionRollup(records: MatchRecord[]): string {
  const tally = newTally()
  const stats: SessionStats = { e: 0, a: 0, dth: 0, statted: 0 }
  const epochs: number[] = []
  for (const r of records) {
    bumpTally(tally, r.data?.result)
    accumulateStats(stats, r)
    const t = matchEpoch(r)
    if (t != null) epochs.push(t)
  }
  const parts: string[] = [wldLine(tally)]
  const span = spanLine(epochs)
  if (span) parts.push(span)
  if (stats.statted > 0) {
    parts.push(`avg ${Math.round(stats.e / stats.statted)}/${Math.round(stats.a / stats.statted)}/${Math.round(stats.dth / stats.statted)}`)
  }
  return parts.join(' · ')
}

export function useMatchesGroup(
  records: Readonly<Ref<MatchRecord[]>>,
  groupBy: Readonly<Ref<GroupBy>>,
  sortOrder: Readonly<Ref<SortOrder>>,
) {
  const sortedRecords = computed(() => {
    return [...records.value].sort((a, b) => {
      return sortOrder.value === 'newest'
        ? sortKey(b).localeCompare(sortKey(a))
        : sortKey(a).localeCompare(sortKey(b))
    })
  })

  const groupedSections = computed<GroupedSection[]>(() => {
    // Pinned matches lead the list in their own section regardless of
    // grouping mode; the remaining records group as before. Sort order
    // still applies inside the pinned section.
    const pinned = sortedRecords.value.filter(r => r.pinned)
    const sections = buildSections(
      pinned.length ? sortedRecords.value.filter(r => !r.pinned) : sortedRecords.value,
    )
    if (pinned.length > 0) {
      sections.unshift({ key: 'pinned', header: '★ Pinned', records: pinned })
    }
    return sections
  })

  function buildSections(base: MatchRecord[]): GroupedSection[] {
    if (groupBy.value === 'none') {
      return [{ key: 'all', header: null, records: base }]
    }
    if (groupBy.value === 'provenance') return buildProvenanceSections(base)
    if (groupBy.value === 'session') return buildSessionSections(base)
    return buildDateSections(base, groupBy.value)
  }

  return { sortedRecords, groupedSections }
}

// Provenance is a categorical grouping (not date-bucketed): each
// section holds that source's records, still date-sorted within.
// Empty buckets drop out so a corpus with no edited matches doesn't
// show an empty "Edited" divider.
function buildProvenanceSections(base: MatchRecord[]): GroupedSection[] {
  return PROVENANCE_SECTIONS
    .map((s) => ({ key: s.key, header: s.header, records: base.filter(s.match) }))
    .filter((s) => s.records.length > 0)
}

// Sessions are sequence-derived, not per-record bucketed: walk the
// display-ordered records and break whenever adjacent placeable
// times sit further apart than the momentum widgets' session gap.
// Records without a placeable time collect into the trailing
// no-date section — a session is definitionally about WHEN.
function buildSessionSections(base: MatchRecord[]): GroupedSection[] {
  const gapMs = SESSION_GAP_HOURS * 3_600_000
  const sections: GroupedSection[] = []
  let cur: GroupedSection | null = null
  let prevEpoch: number | null = null
  let noDateSection: GroupedSection | null = null
  for (const rec of base) {
    const t = matchEpoch(rec)
    if (t == null) {
      if (!noDateSection) noDateSection = { key: 'no-date', header: 'No date', records: [] }
      noDateSection.records.push(rec)
      continue
    }
    if (!cur || prevEpoch == null || Math.abs(t - prevEpoch) > gapMs) {
      cur = { key: `session-${rec.match_key}`, header: '', records: [] }
      sections.push(cur)
    }
    cur.records.push(rec)
    prevEpoch = t
  }
  for (const s of sections) {
    s.header = sessionHeader(s.records)
    s.rollup = sessionRollup(s.records)
  }
  if (noDateSection) sections.push(noDateSection)
  return sections
}

// Records without a parseable date collect into a dedicated
// "no-date" section that's always appended at the end of the
// list, regardless of sort order. Otherwise they end up
// wherever their parsed_at timestamp lands them in the dated
// stream — which is jarring when a recently-parsed undated
// row jumps to the top of "newest first" above genuinely
// recent matches.
function buildDateSections(base: MatchRecord[], bucket: GroupBy): GroupedSection[] {
  const sections: GroupedSection[] = []
  let cur: GroupedSection | null = null
  let noDateSection: GroupedSection | null = null
  for (const rec of base) {
    const { key, label } = bucketFor(rec.data?.date ?? '', bucket)
    if (key === 'no-date') {
      if (!noDateSection) noDateSection = { key, header: label, records: [] }
      noDateSection.records.push(rec)
      continue
    }
    if (!cur || cur.key !== key) {
      cur = { key, header: label, records: [] }
      sections.push(cur)
    }
    cur.records.push(rec)
  }
  if (noDateSection) sections.push(noDateSection)
  return sections
}

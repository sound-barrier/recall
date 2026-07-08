import type { MatchRecord } from '@/api-client'
import { matchTime } from '@/match/match-time-helpers'
import { rolesForHeader } from '@/match/match-helpers'
import type { Season } from '@/composables/shared/useOWData'
import { seasonWindowToLocalDates } from '@/match/match-season-helpers'

// Form-comparison slicing: split the corpus into two adjacent windows — by
// local calendar time (with the previous period mirrored to the same length)
// or by match count (last N vs the N before). All pure over a record slice so
// the pairing math is unit-testable; the view feeds the two sides into the
// same dossier/compare engine the Seasons mode uses.

// A local calendar-day window, both ends inclusive — the same [from, to]
// vocabulary the narrow's date filter uses, so a drill-through that writes
// these bounds into customFrom/customTo shows exactly the compared set.
export interface TimeWindow {
  from: string // YYYY-MM-DD
  to: string // YYYY-MM-DD
}

export interface FormPair {
  a: MatchRecord[] // baseline (older window)
  b: MatchRecord[] // compared (recent window)
  aWindow: TimeWindow | null
  bWindow: TimeWindow | null
  // Records with no derivable time — they can't be placed in either window.
  untimed: number
}

// ─── Day math (local calendar) ────────────────────────────────────────────

function parseYMD(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y!, m! - 1, d!)
}

function toYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(ymd: string, n: number): string {
  const d = parseYMD(ymd)
  d.setDate(d.getDate() + n)
  return toYMD(d)
}

// Inclusive day count of a window ("2026-03-03".."2026-03-09" → 7).
export function windowDays(w: TimeWindow): number {
  const ms = parseYMD(w.to).getTime() - parseYMD(w.from).getTime()
  return Math.round(ms / 86_400_000) + 1
}

// The immediately-preceding window of identical length — the "previous period"
// a picked range mirrors against.
export function mirrorPreviousWindow(w: TimeWindow): TimeWindow {
  const len = windowDays(w)
  return { from: addDays(w.from, -len), to: addDays(w.from, -1) }
}

// The trailing n-day window ending today ("last 7 days" presets).
export function trailingWindow(days: number, today = new Date()): TimeWindow {
  const to = toYMD(today)
  return { from: addDays(to, -(days - 1)), to }
}

// ─── Slicing ──────────────────────────────────────────────────────────────

function stampOf(r: MatchRecord): string {
  return matchTime(r) || (r.data?.date ?? '')
}

function inWindow(stamp: string, w: TimeWindow): boolean {
  const date = stamp.slice(0, 10)
  return date >= w.from && date <= w.to
}

// pairByTime places timed records into the two windows by their local match
// date. Unlike the narrow's date predicate, an undated record belongs to
// NEITHER window (it can't be compared), and is surfaced in `untimed`.
export function pairByTime(records: MatchRecord[], bWindow: TimeWindow, aWindow: TimeWindow): FormPair {
  const a: MatchRecord[] = []
  const b: MatchRecord[] = []
  let untimed = 0
  for (const r of records) {
    const stamp = stampOf(r)
    if (!stamp) { untimed++; continue }
    if (inWindow(stamp, bWindow)) b.push(r)
    else if (inWindow(stamp, aWindow)) a.push(r)
  }
  return { a, b, aWindow, bWindow, untimed }
}

// pairByMatches takes the last n timed matches as the compared window and the
// n before them as the baseline. Fair by construction — both sides carry the
// same match count (when enough history exists). Windows are derived from each
// side's first/last match date so drill-through can still express them.
export function pairByMatches(records: MatchRecord[], n: number): FormPair {
  const timed = records
    .map((r) => ({ r, stamp: stampOf(r) }))
    .filter((x) => x.stamp !== '')
  const untimed = records.length - timed.length
  timed.sort((x, y) => x.stamp.localeCompare(y.stamp))
  const b = timed.slice(-n).map((x) => x.r)
  const a = timed.slice(Math.max(0, timed.length - 2 * n), Math.max(0, timed.length - n)).map((x) => x.r)
  return { a, b, aWindow: derivedWindow(a), bWindow: derivedWindow(b), untimed }
}

function derivedWindow(slice: MatchRecord[]): TimeWindow | null {
  if (slice.length === 0) return null
  const dates = slice.map((r) => stampOf(r).slice(0, 10)).sort()
  return { from: dates[0]!, to: dates[dates.length - 1]! }
}

// samePointWindows compares this season so far against the previous season
// truncated to the same elapsed days — the only fair mid-season comparison.
// null when now falls outside every season or there is no previous season.
export function samePointWindows(seasons: Season[], now = new Date()): { a: TimeWindow; b: TimeWindow } | null {
  const nowMs = now.getTime()
  const parsed = seasons
    .map((s) => ({ s, startMs: Date.parse(s.start), endMs: Date.parse(s.end) }))
    .filter((x) => !Number.isNaN(x.startMs) && !Number.isNaN(x.endMs))
    .sort((x, y) => x.startMs - y.startMs)
  const idx = parsed.findIndex((x) => nowMs >= x.startMs && nowMs < x.endMs)
  if (idx < 1) return null
  const current = parsed[idx]!
  const prev = parsed[idx - 1]!
  const currentDays = seasonWindowToLocalDates({ startMs: current.startMs, endMs: current.endMs })
  const prevDays = seasonWindowToLocalDates({ startMs: prev.startMs, endMs: prev.endMs })
  const b: TimeWindow = { from: currentDays.from, to: toYMD(now) }
  const elapsed = windowDays(b)
  const a: TimeWindow = { from: prevDays.from, to: addDays(prevDays.from, elapsed - 1) }
  return { a, b }
}

// ─── Conditions (per-column slice filters) ────────────────────────────────

export type FormCondition =
  | { kind: 'any' }
  | { kind: 'member'; name: string } // duo/stack: played with this member
  | { kind: 'solo' } // no group members annotated
  | { kind: 'weekday' }
  | { kind: 'weekend' }
  | { kind: 'role'; role: string }
  | { kind: 'hero'; hero: string }

type HeroRoleResolver = (hero: string | null | undefined) => string

export function conditionPredicate(
  cond: FormCondition,
  heroRole: HeroRoleResolver,
): (r: MatchRecord) => boolean {
  switch (cond.kind) {
    case 'any':
      return () => true
    case 'member':
      return (r) => (r.annotation?.members ?? []).includes(cond.name)
    case 'solo':
      return (r) => (r.annotation?.members ?? []).length === 0
    case 'weekday':
      return (r) => isWeekend(r) === false
    case 'weekend':
      return (r) => isWeekend(r) === true
    case 'role':
      // rolesForHeader is the role set the narrow's role filter uses — keeping
      // the condition on the same set makes a role drill-through exact.
      return (r) => rolesForHeader(r, heroRole).includes(cond.role)
    case 'hero':
      return (r) => (r.data?.heroes_played ?? []).some((hp) => hp.hero === cond.hero) || r.data?.hero === cond.hero
  }
}

// buildCondition maps the view's <select> value (+ its sub-pick) to a
// FormCondition; an unfilled sub-pick degrades to "any" rather than filtering
// everything out.
export function buildCondition(kind: string, member: string, hero: string): FormCondition {
  switch (kind) {
    case 'member': return member ? { kind: 'member', name: member } : { kind: 'any' }
    case 'solo': return { kind: 'solo' }
    case 'weekday': return { kind: 'weekday' }
    case 'weekend': return { kind: 'weekend' }
    case 'role:tank': return { kind: 'role', role: 'tank' }
    case 'role:dps': return { kind: 'role', role: 'dps' }
    case 'role:support': return { kind: 'role', role: 'support' }
    case 'hero': return hero ? { kind: 'hero', hero } : { kind: 'any' }
    default: return { kind: 'any' }
  }
}

// Saturday/Sunday by the match's local wall-clock date; null-time records
// resolve to false for both weekday and weekend via NaN day-of-week.
function isWeekend(r: MatchRecord): boolean | null {
  const stamp = stampOf(r)
  if (!stamp) return null
  const day = parseYMD(stamp.slice(0, 10)).getDay()
  return day === 0 || day === 6
}

// A condition is drill-able when the Matches narrow can express it — member,
// role, and hero picks exist; solo/weekday/weekend have no narrow equivalent.
export function conditionDrillable(cond: FormCondition): boolean {
  return cond.kind === 'any' || cond.kind === 'member' || cond.kind === 'role' || cond.kind === 'hero'
}

// ─── Rolling winrate (the verdict card's sparkline) ───────────────────────

// One point per decisive match: the winrate (0–100) over the trailing
// `window` decisive results — the single-line shape of a period. Draws and
// undecided rows are skipped, matching the house winrate convention.
export function rollingWinrate(records: MatchRecord[], window = 5): number[] {
  const results = records
    .map((r) => ({ stamp: stampOf(r), result: r.data?.result }))
    .filter((x) => x.stamp !== '' && (x.result === 'victory' || x.result === 'defeat'))
    .sort((x, y) => x.stamp.localeCompare(y.stamp))
    .map((x) => x.result === 'victory')
  const points: number[] = []
  for (let i = 0; i < results.length; i++) {
    const start = Math.max(0, i - window + 1)
    const slice = results.slice(start, i + 1)
    const wins = slice.filter(Boolean).length
    points.push(Math.round((wins / slice.length) * 100))
  }
  return points
}

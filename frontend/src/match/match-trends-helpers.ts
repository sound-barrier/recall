// Pure time-series builders for the Matches "Trends" charts. Each takes
// the narrowed match set and emits chart-ready series keyed on the
// match's wall-clock time, split by ROLE bucket (OW2 role queue tracks a
// separate rank/record per role; open queue is one combined line). No
// charting-library types live here — that coupling stays in the trends
// components; this file is the data layer and is unit-tested in isolation.
//
// Sibling helpers: match-time-helpers.ts (match time + clock formats),
// match-stats-helpers.ts (W/L/D tally + numeric formats).

import type { MatchRecord } from '@/api-client'
import { matchTime, type WeekStart } from '@/match/match-time-helpers'
import { DAY_OF_WEEK_LABELS, makeTimeOfDayLabels } from '@/composables/matches/useMatchesDossier.types'

// The slice of a match record the trend builders read. Narrowed so
// callers (and tests) don't have to satisfy fields these never touch.
// `queue_type` is the EFFECTIVE (override-aware) value on the record top
// level — same field match-label-helpers reads — not the parsed
// `data.queue_type`.
export type TrendInput = Pick<MatchRecord, 'match_key' | 'data' | 'queue_type'>

// One point on a plain trend line: `t` is epoch milliseconds (an ECharts
// time-axis value), `v` the metric reading at that match. `matchKey` is
// the match the point came from, so a chart click can open it.
interface TrendPoint {
  t: number
  v: number
  matchKey: string
}

// A named line: legend label + its points in ascending time order.
// `key` is the role-bucket key (tank/dps/support/open/all) so the
// presentation layer can color role lines consistently across charts.
export interface TrendSeries {
  name: string
  key?: string
  points: TrendPoint[]
}

// The OW2 competitive tier ladder, lowest → highest. Matches the parser's
// `knownRanks` (pkg/parser/parse_rank.go) and the data's lowercase `rank`.
export const TIER_ORDER = [
  'bronze', 'silver', 'gold', 'platinum', 'diamond', 'master', 'grandmaster', 'champion',
] as const
export type Tier = typeof TIER_ORDER[number]

// Which chart line a match belongs to. Role queue splits by the role
// played; open queue collapses to one line.
export interface RoleBucket {
  key: string
  label: string
}

const ROLE_LABEL: Record<string, string> = { tank: 'Tank', dps: 'DPS', support: 'Support' }

// Stable legend / series order regardless of which matches land first.
const ROLE_ORDER = ['tank', 'dps', 'support', 'open', 'all']

// roleBucket decides which line a match contributes to. Role-queue matches
// split by their played role; open-queue matches share one "Open queue"
// line; when the queue is unknown we fall back to the role if we have one,
// else a single combined line.
export function roleBucket(rec: Pick<MatchRecord, 'data' | 'queue_type'>): RoleBucket {
  const role = rec.data?.role ?? ''
  if (rec.queue_type === 'open') return { key: 'open', label: 'Open queue' }
  if (rec.queue_type === 'role' && role) return { key: role, label: ROLE_LABEL[role] ?? role }
  if (role) return { key: role, label: ROLE_LABEL[role] ?? role }
  return { key: 'all', label: 'All' }
}

// Epoch milliseconds for a record's match time. Reuses matchTime()
// (SUMMARY date + finished_at, else the match_key timestamp) so the
// trends honor the same "when did this match happen" rule as the rest
// of the workspace. Returns null when neither source yields a parseable
// time — such rows can't be placed on a time axis and are dropped.
export function matchEpoch(rec: Pick<MatchRecord, 'match_key' | 'data'>): number | null {
  const stamp = matchTime(rec)
  if (!stamp) return null
  const ms = new Date(stamp).getTime()
  return Number.isNaN(ms) ? null : ms
}

// Records that carry a placeable time, paired with that epoch and
// sorted oldest-first. Shared spine for every series builder so they
// all walk the corpus in the same chronological order.
function timedRecords(records: readonly TrendInput[]): { rec: TrendInput; t: number }[] {
  const timed: { rec: TrendInput; t: number }[] = []
  for (const rec of records) {
    const t = matchEpoch(rec)
    if (t != null) timed.push({ rec, t })
  }
  timed.sort((a, b) => a.t - b.t)
  return timed
}

// A continuous, monotonic ladder position for a rank reading. Division 1
// is the TOP of a tier (climb 5 → 1, then promote), so within-tier height
// is `5 - level`; a full tier spans 5 units, progress (−100..100) refines
// position within a division. Returns null for an unknown tier. So
// "Diamond 1 @ 100%" lands exactly on the Master boundary.
export function ladderScore(tier: string, level: number, progress: number): number | null {
  const tierIndex = (TIER_ORDER as readonly string[]).indexOf(tier)
  if (tierIndex < 0) return null
  const division = Math.min(5, Math.max(1, Math.floor(level)))
  const clampedProgress = Math.max(-100, Math.min(100, progress))
  return tierIndex * 5 + (5 - division) + clampedProgress / 100
}

// One rank reading, carrying the raw fields the chart tooltip needs
// alongside the plotted ladder score.
export interface RankPoint {
  t: number
  score: number
  tier: Tier
  level: number
  progress: number
  change: number
  matchKey: string
}

export interface RankSeries {
  key: string
  label: string
  points: RankPoint[]
}

function orderBuckets<T extends { key: string }>(series: T[]): T[] {
  return series.sort((a, b) => {
    const ai = ROLE_ORDER.indexOf(a.key)
    const bi = ROLE_ORDER.indexOf(b.key)
    return (ai < 0 ? ROLE_ORDER.length : ai) - (bi < 0 ? ROLE_ORDER.length : bi)
  })
}

// Rank-over-time, one line per role bucket. Only matches that carry a
// rank tier + level (i.e. a RANK screenshot was parsed) contribute.
export function rankLadderSeries(records: readonly TrendInput[]): RankSeries[] {
  const byBucket = new Map<string, { label: string; points: RankPoint[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const data = rec.data
    const tier = data?.rank
    if (!tier || !(TIER_ORDER as readonly string[]).includes(tier) || typeof data?.level !== 'number') continue
    const progress = data.rank_progress ?? 0
    const score = ladderScore(tier, data.level, progress)
    if (score == null) continue
    const bucket = roleBucket(rec)
    const entry = byBucket.get(bucket.key) ?? { label: bucket.label, points: [] }
    entry.points.push({
      t,
      score,
      tier: tier as Tier,
      level: data.level,
      progress,
      change: data.change_percent ?? 0,
      matchKey: rec.match_key,
    })
    byBucket.set(bucket.key, entry)
  }
  return orderBuckets([...byBucket.entries()].map(([key, e]) => ({ key, label: e.label, points: e.points })))
}

// Rolling win-rate per HERO (the per-hero trend: "improving on Juno,
// regressing on Ana"). Same rolling window as rollingWinrateSeries,
// but bucketed by the record's primary hero and limited to the
// topHeroes most-played heroes by decisive-match volume — every hero
// in a wide pool would be twenty one-game lines, which charts noise.
export function heroRollingWinrateSeries(
  records: readonly TrendInput[],
  window: number,
  topHeroes = 5,
): TrendSeries[] {
  const span = Math.max(1, Math.floor(window))
  const byHero = new Map<string, { decisive: boolean[]; times: number[]; keys: string[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    let win: boolean
    if (result === 'victory') win = true
    else if (result === 'defeat') win = false
    else continue
    const hero = rec.data?.hero
    if (!hero) continue
    const entry = byHero.get(hero) ?? { decisive: [], times: [], keys: [] }
    entry.decisive.push(win)
    entry.times.push(t)
    entry.keys.push(rec.match_key)
    byHero.set(hero, entry)
  }
  const kept = [...byHero.entries()]
    .sort((a, b) => b[1].decisive.length - a[1].decisive.length)
    .slice(0, topHeroes)

  const series: TrendSeries[] = []
  for (const [hero, entry] of kept) {
    const points: TrendPoint[] = []
    for (let i = 0; i < entry.decisive.length; i++) {
      const start = Math.max(0, i - span + 1)
      let wins = 0
      for (let j = start; j <= i; j++) {
        if (entry.decisive[j]) wins++
      }
      const n = i - start + 1
      points.push({ t: entry.times[i]!, v: Math.round((wins / n) * 100), matchKey: entry.keys[i]! })
    }
    series.push({ name: hero, key: hero, points })
  }
  return series
}

// Rolling win-rate per MAP (the per-map trend: "climbing on Numbani,
// sinking on Ilios"). Same rolling window and top-N shape as
// heroRollingWinrateSeries, but bucketed by the match's map and limited to
// the topMaps most-played by decisive-match volume so a wide rotation
// doesn't chart twenty one-game lines.
export function mapRollingWinrateSeries(
  records: readonly TrendInput[],
  window: number,
  topMaps = 5,
): TrendSeries[] {
  const span = Math.max(1, Math.floor(window))
  const byMap = new Map<string, { decisive: boolean[]; times: number[]; keys: string[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    let win: boolean
    if (result === 'victory') win = true
    else if (result === 'defeat') win = false
    else continue
    const map = rec.data?.map
    if (!map) continue
    const entry = byMap.get(map) ?? { decisive: [], times: [], keys: [] }
    entry.decisive.push(win)
    entry.times.push(t)
    entry.keys.push(rec.match_key)
    byMap.set(map, entry)
  }
  const kept = [...byMap.entries()]
    .sort((a, b) => b[1].decisive.length - a[1].decisive.length)
    .slice(0, topMaps)

  const series: TrendSeries[] = []
  for (const [map, entry] of kept) {
    const points: TrendPoint[] = []
    for (let i = 0; i < entry.decisive.length; i++) {
      const start = Math.max(0, i - span + 1)
      let wins = 0
      for (let j = start; j <= i; j++) {
        if (entry.decisive[j]) wins++
      }
      const n = i - start + 1
      points.push({ t: entry.times[i]!, v: Math.round((wins / n) * 100), matchKey: entry.keys[i]! })
    }
    series.push({ name: map, key: map, points })
  }
  return series
}

// Trailing win-rate (%) over the last `window` decisive matches, one line
// per role bucket. Draws are excluded from numerator and denominator
// (matching the dossier's headline winrate). One point per decisive
// match, so early points average over a shorter prefix than the window.
export function rollingWinrateSeries(records: readonly TrendInput[], window: number): TrendSeries[] {
  const span = Math.max(1, Math.floor(window))
  const byBucket = new Map<string, { label: string; decisive: boolean[]; times: number[]; keys: string[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    let win: boolean
    if (result === 'victory') win = true
    else if (result === 'defeat') win = false
    else continue
    const bucket = roleBucket(rec)
    const entry = byBucket.get(bucket.key) ?? { label: bucket.label, decisive: [], times: [], keys: [] }
    entry.decisive.push(win)
    entry.times.push(t)
    entry.keys.push(rec.match_key)
    byBucket.set(bucket.key, entry)
  }

  const series: TrendSeries[] = []
  for (const [key, entry] of byBucket) {
    const points: TrendPoint[] = []
    for (let i = 0; i < entry.decisive.length; i++) {
      const start = Math.max(0, i - span + 1)
      let wins = 0
      for (let j = start; j <= i; j++) {
        if (entry.decisive[j]) wins++
      }
      const n = i - start + 1
      points.push({ t: entry.times[i]!, v: Math.round((wins / n) * 100), matchKey: entry.keys[i]! })
    }
    series.push({ name: entry.label, key, points })
  }
  return orderBuckets(series as (TrendSeries & { key: string })[])
}

// The latest rank reading per role bucket — drives the "Current rank"
// dossier widget. Each entry is the most recent rank-bearing match for
// that role (or the single open-queue / combined line).
export interface RankNow {
  key: string
  label: string
  tier: Tier
  level: number
  progress: number
}

export function currentRankByRole(records: readonly TrendInput[]): RankNow[] {
  const latest = new Map<string, { t: number } & RankNow>()
  // timedRecords is oldest-first, so a later match with `t >= prev.t`
  // wins — the last write per bucket is the newest reading.
  for (const { rec, t } of timedRecords(records)) {
    const data = rec.data
    const tier = data?.rank
    if (!tier || !(TIER_ORDER as readonly string[]).includes(tier) || typeof data?.level !== 'number') continue
    const bucket = roleBucket(rec)
    const prev = latest.get(bucket.key)
    if (!prev || t >= prev.t) {
      latest.set(bucket.key, {
        t,
        key: bucket.key,
        label: bucket.label,
        tier: tier as Tier,
        level: data.level,
        progress: data.rank_progress ?? 0,
      })
    }
  }
  return orderBuckets([...latest.values()].map(({ t: _t, ...rank }) => rank))
}

// The W/L/D outcome modifiers are already the win-rate chart's job —
// exclude them from the modifier-frequency lines / breakdown so only the
// *qualitative* modifiers (uphill battle, reversal, consolation, win/loss
// streak, calibration, volatile, demotion protection, …) show. Shared with
// the modifier dossier widgets.
export const RESULT_MODIFIERS: ReadonlySet<string> = new Set(['victory', 'defeat', 'draw'])

// The non-result rank-update modifiers, in canonical order — the parser's
// knownModifiers minus victory/defeat/draw, plus demotion protection.
// Drives the narrow panel's modifier filter chips (ordered, complete) so
// the user can scope to "show my uphill battles / reversals / …".
export const FILTERABLE_MODIFIERS = [
  'expected', 'uphill battle', 'reversal', 'consolation',
  'win streak', 'loss streak', 'winning trend', 'losing trend',
  'calibration', 'volatile',
  'demotion protection',
] as const

// Per-match rank delta — the signed ±change% the rank meter moved, one
// series per role bucket (rank-bearing matches only). Drives the rank-
// delta bar chart; the rank-ladder line shows this only on hover.
export function rankDeltaSeries(records: readonly TrendInput[]): TrendSeries[] {
  const byBucket = new Map<string, { label: string; points: TrendPoint[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const data = rec.data
    const tier = data?.rank
    if (!tier || !(TIER_ORDER as readonly string[]).includes(tier) || typeof data?.change_percent !== 'number') continue
    const bucket = roleBucket(rec)
    const entry = byBucket.get(bucket.key) ?? { label: bucket.label, points: [] }
    entry.points.push({ t, v: data.change_percent, matchKey: rec.match_key })
    byBucket.set(bucket.key, entry)
  }
  return orderBuckets([...byBucket.entries()].map(([key, e]) => ({ name: e.label, key, points: e.points })))
}

// Cumulative net record — a running Σ(win +1 / loss −1) over decisive
// matches, one line per role bucket. Rises while you're net-winning,
// falls while net-losing; a smoother climb signal than rolling win-rate.
export function cumulativeNetRecordSeries(records: readonly TrendInput[]): TrendSeries[] {
  const byBucket = new Map<string, { label: string; points: TrendPoint[]; net: number }>()
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    let delta: number
    if (result === 'victory') delta = 1
    else if (result === 'defeat') delta = -1
    else continue
    const bucket = roleBucket(rec)
    const entry = byBucket.get(bucket.key) ?? { label: bucket.label, points: [], net: 0 }
    entry.net += delta
    entry.points.push({ t, v: entry.net, matchKey: rec.match_key })
    byBucket.set(bucket.key, entry)
  }
  return orderBuckets([...byBucket.entries()].map(([key, e]) => ({ name: e.label, key, points: e.points })))
}

// Modifier frequency over time — a cumulative-count line per non-result
// modifier. One line per modifier that appears (most-frequent first).
export function modifierFrequencySeries(records: readonly TrendInput[]): TrendSeries[] {
  const byModifier = new Map<string, { points: TrendPoint[]; count: number }>()
  for (const { rec, t } of timedRecords(records)) {
    for (const modifier of rec.data?.modifiers ?? []) {
      if (!modifier || RESULT_MODIFIERS.has(modifier)) continue
      const entry = byModifier.get(modifier) ?? { points: [], count: 0 }
      entry.count += 1
      entry.points.push({ t, v: entry.count, matchKey: rec.match_key })
      byModifier.set(modifier, entry)
    }
  }
  return [...byModifier.entries()]
    .map(([name, e]) => ({ name, key: name, points: e.points }))
    .sort((a, b) => b.points.length - a.points.length || a.name.localeCompare(b.name))
}

// Combat output per 10 minutes over time — one line each for eliminations,
// deaths, and assists, from the scoreboard's per-10-min figures (which
// normalize for game length). These stats have intermittent OCR coverage —
// they come from a SUMMARY/PERSONAL scoreboard screenshot, not the rank
// screen — so a match contributes a point to a metric only when that figure
// was parsed; the chart connects across the gaps. A rising eliminations /
// assists line or a falling deaths line is the "am I improving mechanically,
// not just climbing?" signal. Keyed so the presentation layer colors them
// semantically (eliminations green, deaths red, assists blue).
const COMBAT_METRICS = [
  { key: 'eliminations', name: 'Eliminations' },
  { key: 'deaths', name: 'Deaths' },
  { key: 'assists', name: 'Assists' },
] as const

export function combatSeries(records: readonly TrendInput[]): TrendSeries[] {
  const byMetric = new Map<string, TrendPoint[]>(COMBAT_METRICS.map((m) => [m.key, []]))
  for (const { rec, t } of timedRecords(records)) {
    const perf = rec.data?.performance
    if (!perf) continue
    for (const m of COMBAT_METRICS) {
      const v = perf[m.key]?.avg_per_10min
      if (typeof v !== 'number') continue
      byMetric.get(m.key)!.push({ t, v: Math.round(v * 10) / 10, matchKey: rec.match_key })
    }
  }
  // Keep the E/D/A order; drop a metric that has no coverage at all.
  return COMBAT_METRICS
    .map((m) => ({ name: m.name, key: m.key, points: byMetric.get(m.key)! }))
    .filter((s) => s.points.length > 0)
}

// One cell of the day-of-week × time-of-day win-rate grid ("when do I play
// my best?"). `x` is the time-bucket column, `y` the day row (after the
// week-start rotation). Cells with no decisive match are omitted from the
// grid entirely so the chart leaves them blank rather than coloring 0%.
interface WinrateCell {
  x: number
  y: number
  wins: number
  total: number
  winRate: number
}

export interface WinrateGrid {
  dayLabels: string[]    // rows top→bottom, rotated to the week-start
  bucketLabels: string[] // columns, e.g. 00–04 … 20–24
  cells: WinrateCell[]
}

// Cross day-of-week (from `data.date`, read in UTC like the dossier's
// day-of-week breakdown) with time-of-day (from `data.finished_at`'s hour,
// bucketed) and compute win-rate per cell over decisive matches. `weekStart`
// rotates the day rows so row 0 is the user's first day of the week. Pure —
// the composable layer supplies the reactive weekStart.
export function dayTimeWinrateGrid(
  records: readonly TrendInput[],
  bucketCount: 6 | 12 | 24,
  weekStart: WeekStart = 0,
): WinrateGrid {
  const hoursPerBucket = 24 / bucketCount
  const wins = Array.from({ length: 7 }, () => new Array<number>(bucketCount).fill(0))
  const total = Array.from({ length: 7 }, () => new Array<number>(bucketCount).fill(0))
  for (const rec of records) {
    const result = rec.data?.result
    let win: boolean
    if (result === 'victory') win = true
    else if (result === 'defeat') win = false
    else continue
    const date = rec.data?.date
    const fa = rec.data?.finished_at
    if (!date || !fa || fa.length < 2) continue
    const day = new Date(date + 'T00:00:00Z').getUTCDay()
    const hour = Number.parseInt(fa.slice(0, 2), 10)
    if (!Number.isFinite(day) || day < 0 || day > 6) continue
    if (!Number.isFinite(hour) || hour < 0 || hour > 23) continue
    const bucket = Math.floor(hour / hoursPerBucket)
    total[day]![bucket]!++
    if (win) wins[day]![bucket]!++
  }
  const bucketLabels = makeTimeOfDayLabels(bucketCount)
  const dayLabels: string[] = []
  const cells: WinrateCell[] = []
  for (let row = 0; row < 7; row++) {
    const srcDay = (weekStart + row) % 7
    dayLabels.push(DAY_OF_WEEK_LABELS[srcDay]!)
    for (let x = 0; x < bucketCount; x++) {
      const t = total[srcDay]![x]!
      if (t === 0) continue
      const w = wins[srcDay]![x]!
      cells.push({ x, y: row, wins: w, total: t, winRate: Math.round((w / t) * 100) })
    }
  }
  return { dayLabels, bucketLabels, cells }
}

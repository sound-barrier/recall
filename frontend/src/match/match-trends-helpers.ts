// Pure time-series builders for the Matches "Trends" charts. Each takes
// the narrowed match set and emits chart-ready series keyed on the
// match's wall-clock time, split by ROLE bucket (OW2 role queue tracks a
// separate rank/record per role; open queue is one combined line). No
// charting-library types live here — that coupling stays in the trends
// components; this file is the data layer and is unit-tested in isolation.
//
// Sibling helpers: match-time-helpers.ts (match time + clock formats),
// match-stats-helpers.ts (W/L/D tally + numeric formats).

import type { MatchRecord } from '@/api'
import { matchTime } from '@/match/match-time-helpers'

// The slice of a match record the trend builders read. Narrowed so
// callers (and tests) don't have to satisfy fields these never touch.
// `queue_type` is the EFFECTIVE (override-aware) value on the record top
// level — same field match-label-helpers reads — not the parsed
// `data.queue_type`.
export type TrendInput = Pick<MatchRecord, 'match_key' | 'data' | 'queue_type'>

// One point on a plain trend line: `t` is epoch milliseconds (an ECharts
// time-axis value), `v` the metric reading at that match.
interface TrendPoint {
  t: number
  v: number
}

// A named line: legend label + its points in ascending time order.
// `key` is the role-bucket key (tank/dps/support/open/all) so the
// presentation layer can colour role lines consistently across charts.
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
// trends honour the same "when did this match happen" rule as the rest
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
    })
    byBucket.set(bucket.key, entry)
  }
  return orderBuckets([...byBucket.entries()].map(([key, e]) => ({ key, label: e.label, points: e.points })))
}

// Trailing win-rate (%) over the last `window` decisive matches, one line
// per role bucket. Draws are excluded from numerator and denominator
// (matching the dossier's headline winrate). One point per decisive
// match, so early points average over a shorter prefix than the window.
export function rollingWinrateSeries(records: readonly TrendInput[], window: number): TrendSeries[] {
  const span = Math.max(1, Math.floor(window))
  const byBucket = new Map<string, { label: string; decisive: boolean[]; times: number[] }>()
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    let win: boolean
    if (result === 'victory') win = true
    else if (result === 'defeat') win = false
    else continue
    const bucket = roleBucket(rec)
    const entry = byBucket.get(bucket.key) ?? { label: bucket.label, decisive: [], times: [] }
    entry.decisive.push(win)
    entry.times.push(t)
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
      points.push({ t: entry.times[i]!, v: Math.round((wins / n) * 100) })
    }
    series.push({ name: entry.label, key, points })
  }
  return orderBuckets(series as (TrendSeries & { key: string })[])
}

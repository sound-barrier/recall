// Pure time-series builders for the Matches "Trends" charts. Each
// takes the narrowed match set and emits chart-ready `{t, v}` series
// keyed on the match's wall-clock time. No charting-library types
// live here — that coupling stays in the trends components; this file
// is the data layer and is unit-tested in isolation.
//
// Sibling helpers: match-time-helpers.ts (match time + clock formats),
// match-stats-helpers.ts (W/L/D tally + numeric formats).

import type { MatchRecord, MatchResult } from '@/api'
import { matchTime } from '@/match/match-time-helpers'

// The slice of a match record the trend builders read. Narrowed so
// callers (and tests) don't have to satisfy fields these never touch.
export type TrendInput = Pick<MatchRecord, 'match_key' | 'data'>

// One point on a trend line: `t` is epoch milliseconds (an ECharts
// time-axis value), `v` the metric reading at that match. Internal —
// consumers work with whole TrendSeries.
interface TrendPoint {
  t: number
  v: number
}

// A named line: legend label + its points in ascending time order.
export interface TrendSeries {
  name: string
  points: TrendPoint[]
}

// The per-match scalar a user can chart in the stat-trend panel.
// `kda` is derived ((elims + assists) / max(deaths, 1)); the rest read
// straight off the match record.
export type StatKey =
  | 'kda'
  | 'eliminations'
  | 'assists'
  | 'deaths'
  | 'damage'
  | 'healing'
  | 'mitigation'

export const STAT_LABELS: Record<StatKey, string> = {
  kda: 'KDA',
  eliminations: 'Eliminations',
  assists: 'Assists',
  deaths: 'Deaths',
  damage: 'Damage',
  healing: 'Healing',
  mitigation: 'Mitigation',
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

// One SR line per hero that has at least one SR reading, sorted by
// hero name so the legend order is stable as the corpus narrows. SR
// only appears on RANK screenshots, so this is empty for users who
// never capture one.
export function srTrendSeries(records: readonly TrendInput[]): TrendSeries[] {
  const byHero = new Map<string, TrendPoint[]>()
  for (const { rec, t } of timedRecords(records)) {
    for (const reading of rec.data?.sr ?? []) {
      if (!reading?.hero || typeof reading.sr !== 'number') continue
      const points = byHero.get(reading.hero) ?? []
      points.push({ t, v: reading.sr })
      byHero.set(reading.hero, points)
    }
  }
  return [...byHero.entries()]
    .map(([name, points]) => ({ name, points }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

// The chartable value of one stat for a single match, or null when the
// match doesn't carry it (so the point is skipped, not plotted as 0).
function statValue(data: MatchResult | undefined, stat: StatKey): number | null {
  if (!data) return null
  if (stat === 'kda') {
    if (data.eliminations == null && data.assists == null && data.deaths == null) return null
    return ((data.eliminations ?? 0) + (data.assists ?? 0)) / Math.max(data.deaths ?? 0, 1)
  }
  const raw = data[stat]
  return typeof raw === 'number' ? raw : null
}

// A single line of one per-match stat over time.
export function statTrendSeries(records: readonly TrendInput[], stat: StatKey): TrendSeries {
  const points: TrendPoint[] = []
  for (const { rec, t } of timedRecords(records)) {
    const v = statValue(rec.data, stat)
    if (v != null) points.push({ t, v })
  }
  return { name: STAT_LABELS[stat], points }
}

// Trailing win-rate (%) over the last `window` decisive matches. Draws
// are excluded from both numerator and denominator, matching the
// dossier's headline winrate. One point per decisive match, so early
// points average over a shorter prefix than the full window.
export function rollingWinrateSeries(records: readonly TrendInput[], window: number): TrendSeries {
  const decisive: { t: number; win: boolean }[] = []
  for (const { rec, t } of timedRecords(records)) {
    const result = rec.data?.result
    if (result === 'victory') decisive.push({ t, win: true })
    else if (result === 'defeat') decisive.push({ t, win: false })
  }

  const span = Math.max(1, Math.floor(window))
  const points: TrendPoint[] = []
  for (let i = 0; i < decisive.length; i++) {
    const start = Math.max(0, i - span + 1)
    let wins = 0
    for (let j = start; j <= i; j++) {
      if (decisive[j]!.win) wins++
    }
    const n = i - start + 1
    points.push({ t: decisive[i]!.t, v: Math.round((wins / n) * 100) })
  }
  return { name: `Win % (last ${span})`, points }
}

// Three lines — eliminations / assists / deaths per 10 minutes — read
// from the parser's performance block. Lines with no readings across
// the corpus are dropped so the legend only shows what's chartable.
export function per10TrendSeries(records: readonly TrendInput[]): TrendSeries[] {
  const elims: TrendPoint[] = []
  const assists: TrendPoint[] = []
  const deaths: TrendPoint[] = []
  for (const { rec, t } of timedRecords(records)) {
    const perf = rec.data?.performance
    if (!perf) continue
    if (typeof perf.eliminations?.avg_per_10min === 'number') elims.push({ t, v: perf.eliminations.avg_per_10min })
    if (typeof perf.assists?.avg_per_10min === 'number') assists.push({ t, v: perf.assists.avg_per_10min })
    if (typeof perf.deaths?.avg_per_10min === 'number') deaths.push({ t, v: perf.deaths.avg_per_10min })
  }
  return [
    { name: 'Elims / 10', points: elims },
    { name: 'Assists / 10', points: assists },
    { name: 'Deaths / 10', points: deaths },
  ].filter((series) => series.points.length > 0)
}

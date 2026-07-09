// "What actually separates your wins" — each scoreboard stat compared
// between the player's wins and losses, per 10 minutes. The output is a
// ranked list of levers: the stat with the biggest standardized gap is
// the one worth practicing first. Association, not causation — the UI
// carries that fine print; this module just measures honestly.

import type { MatchRecord } from '@/api-client'
import { parseGameLengthMinutes } from '@/match/match-time-helpers'
import { tCdf } from '@/match/elo-stats'

type DriverInput = Pick<MatchRecord, 'data'>
type MatchData = NonNullable<MatchRecord['data']>

export interface StatSeparator {
  key: string
  label: string
  betterWhen: 'lower' | 'higher'
  winMean: number
  lossMean: number
  nWins: number
  nLosses: number
  effect: number // Cohen's d (pooled SD); positive = higher in wins
  pValue: number | null // Welch two-sided; null when the variance degenerates
}

// DRIVER_MIN_ARM: a stat needs at least this many wins AND losses with a
// reading before its split means anything.
const DRIVER_MIN_ARM = 5

// The backend pre-computes per-10 rates for the combat trio; the raw
// totals normalize through the game length.
const perfPer10 = (key: 'eliminations' | 'assists' | 'deaths') => (d: MatchData): number | null => {
  const v = d.performance?.[key]?.avg_per_10min
  return typeof v === 'number' ? v : null
}
const totalPer10 = (key: 'damage' | 'healing' | 'mitigation') => (d: MatchData): number | null => {
  const total = d[key]
  const minutes = parseGameLengthMinutes(d.game_length)
  if (typeof total !== 'number' || minutes === null || minutes <= 0) return null
  return (total / minutes) * 10
}

const STAT_DEFS: readonly {
  key: string
  label: string
  betterWhen: 'lower' | 'higher'
  get: (d: MatchData) => number | null
}[] = [
  { key: 'deaths', label: 'Deaths / 10 min', betterWhen: 'lower', get: perfPer10('deaths') },
  { key: 'eliminations', label: 'Eliminations / 10 min', betterWhen: 'higher', get: perfPer10('eliminations') },
  { key: 'assists', label: 'Assists / 10 min', betterWhen: 'higher', get: perfPer10('assists') },
  { key: 'damage', label: 'Damage / 10 min', betterWhen: 'higher', get: totalPer10('damage') },
  { key: 'healing', label: 'Healing / 10 min', betterWhen: 'higher', get: totalPer10('healing') },
  { key: 'mitigation', label: 'Mitigation / 10 min', betterWhen: 'higher', get: totalPer10('mitigation') },
]

// statSeparators splits every covered stat by result and ranks the
// splits by standardized effect size. Stats with identical values
// everywhere (zero pooled variance) carry no information and drop.
export function statSeparators(records: readonly DriverInput[]): StatSeparator[] {
  const out: StatSeparator[] = []
  for (const def of STAT_DEFS) {
    const wins: number[] = []
    const losses: number[] = []
    for (const rec of records) {
      const d = rec.data
      if (!d) continue
      const result = d.result
      if (result !== 'victory' && result !== 'defeat') continue
      const v = def.get(d)
      if (v === null) continue
      if (result === 'victory') wins.push(v)
      else losses.push(v)
    }
    if (wins.length < DRIVER_MIN_ARM || losses.length < DRIVER_MIN_ARM) continue
    const sep = separate(wins, losses)
    if (sep === null) continue
    out.push({ key: def.key, label: def.label, betterWhen: def.betterWhen, ...sep })
  }
  return out.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect))
}

function separate(wins: number[], losses: number[]): Omit<StatSeparator, 'key' | 'label' | 'betterWhen'> | null {
  const n1 = wins.length
  const n2 = losses.length
  const m1 = mean(wins)
  const m2 = mean(losses)
  const v1 = variance(wins, m1)
  const v2 = variance(losses, m2)
  const pooled = Math.sqrt(((n1 - 1) * v1 + (n2 - 1) * v2) / (n1 + n2 - 2))
  if (pooled === 0) return null
  const seSq = v1 / n1 + v2 / n2
  let pValue: number | null = null
  if (seSq > 0) {
    const t = (m1 - m2) / Math.sqrt(seSq)
    const df = (seSq * seSq) / ((v1 / n1) ** 2 / (n1 - 1) + (v2 / n2) ** 2 / (n2 - 1))
    pValue = Math.min(1, 2 * (1 - tCdf(Math.abs(t), df)))
  }
  return { winMean: m1, lossMean: m2, nWins: n1, nLosses: n2, effect: (m1 - m2) / pooled, pValue }
}

function mean(xs: readonly number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length
}

function variance(xs: readonly number[], m: number): number {
  if (xs.length < 2) return 0
  return xs.reduce((s, v) => s + (v - m) * (v - m), 0) / (xs.length - 1)
}

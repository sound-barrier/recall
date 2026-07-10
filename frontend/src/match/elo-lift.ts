// The Bayesian lift table: every conditional split the app knows —
// heroes, maps, modes, days, times, teammates — expressed as LIFT vs the
// player's own baseline win rate ("×1.3 your usual"), with each small
// sample shrunk toward that baseline (empirical Bayes) so a hot 3–0 can't
// top the chart. One ranked answer to "what actually moves my needle?".

import type { MatchRecord } from '@/api-client'
import { credibleInterval, shrunkWinRate } from '@/match/elo-bayes'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { matchEpoch } from '@/match/match-trends-helpers'

type LiftDimension = 'hero' | 'map' | 'mode' | 'day' | 'time' | 'teammate'

export interface LiftRow {
  dimension: LiftDimension
  key: string
  wins: number
  losses: number
  n: number
  winrate: number // raw integer %
  lift: number // shrunk rate ÷ baseline rate
  liftLo: number // 95% credible bounds on the lift
  liftHi: number
  lowSample: boolean
}

export interface LiftDeps {
  heroRole: (hero: string | null | undefined) => string
  mapGameMode: (map: string | null | undefined) => string
}

export interface LiftOpts {
  minN?: number
  strength?: number
}

type LiftInput = Pick<MatchRecord, 'match_key' | 'data' | 'annotation'>

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// timeBucket names the four dayparts the lift table splits on.
function timeBucket(hour: number): string {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 17) return 'afternoon'
  if (hour >= 17 && hour < 23) return 'evening'
  return 'night'
}

// liftTable tallies every condition, shrinks it toward the corpus
// baseline, and ranks by lift magnitude. Conditions below minN or
// covering (nearly) the whole corpus — which just restate the baseline —
// drop out.
export function liftTable(records: readonly LiftInput[], deps: LiftDeps, opts: LiftOpts = {}): LiftRow[] {
  const minN = opts.minN ?? 5
  const strength = opts.strength ?? 10

  let baseWins = 0
  let baseLosses = 0
  const tallies = new Map<string, { dimension: LiftDimension; key: string; wins: number; losses: number }>()
  const add = (dimension: LiftDimension, key: string | null | undefined, win: boolean) => {
    if (!key) return
    const id = `${dimension}:${key}`
    const t = tallies.get(id) ?? { dimension, key, wins: 0, losses: 0 }
    if (win) t.wins++
    else t.losses++
    tallies.set(id, t)
  }

  for (const rec of records) {
    const d = rec.data
    const result = d?.result
    if (result !== 'victory' && result !== 'defeat') continue
    const win = result === 'victory'
    baseWins += win ? 1 : 0
    baseLosses += win ? 0 : 1

    add('map', d?.map, win)
    add('mode', d?.map ? deps.mapGameMode(d.map) : null, win)
    const t = matchEpoch(rec)
    if (t !== null) {
      const local = new Date(t)
      add('day', DAY_NAMES[local.getDay()], win)
      add('time', timeBucket(local.getHours()), win)
    }
    for (const member of rec.annotation?.members ?? []) add('teammate', member, win)
  }

  const baseN = baseWins + baseLosses
  if (baseN === 0) return []
  const baseRate = baseWins / baseN

  // Heroes come from the pool analysis so multi-hero matches credit each
  // meaningfully-played hero — the same per-hero convention the picker uses.
  const pool = analyzeHeroPool(records, DEFAULT_HERO_MEANINGFUL_PCT, deps.heroRole)
  for (const h of [...pool.pool, ...pool.outHeroes]) {
    tallies.set(`hero:${h.key}`, { dimension: 'hero', key: h.key, wins: h.wins, losses: h.losses })
  }

  const prior = { alpha: strength * baseRate, beta: strength * (1 - baseRate) }
  const rows: LiftRow[] = []
  for (const t of tallies.values()) {
    const n = t.wins + t.losses
    if (n < minN) continue
    // A condition covering ~the whole corpus IS the baseline — no signal.
    if (n >= baseN * 0.95) continue
    const shrunk = shrunkWinRate(t.wins, t.losses, baseWins, baseLosses, strength)
    if (shrunk === null) continue
    const iv = credibleInterval(t.wins, t.losses, prior)
    rows.push({
      dimension: t.dimension,
      key: t.key,
      wins: t.wins,
      losses: t.losses,
      n,
      winrate: Math.round((t.wins / n) * 100),
      lift: shrunk / baseRate,
      liftLo: iv.lower / baseRate,
      liftHi: iv.upper / baseRate,
      lowSample: n < 10,
    })
  }
  return rows.sort((a, b) => Math.abs(b.lift - 1) - Math.abs(a.lift - 1))
}

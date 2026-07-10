// "Your next three moves" — the playbook's opener: up to three ranked,
// concrete actions synthesized from the player's own games. Priority runs
// controllable-first: the review habit (always the biggest lever), the
// strongest game-condition lift, then session hygiene, with pool
// discipline and the after-a-loss dip as fallbacks. Everything is derived
// from primary data so the card can never disagree with the blocks below.

import type { MatchRecord } from '@/api-client'
import type { LiftRow } from '@/match/elo-lift'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { winrateBySessionIndex } from '@/match/match-momentum-helpers'
import { winrateByStreakDepth } from '@/match/elo-streaks'
import { expectedMeterDelta, meterMoveSamples } from '@/match/elo-simulate'
import { LOW_SAMPLE_N } from '@/match/match-sample-helpers'

export interface NextMove {
  id: 'review' | 'lift' | 'session' | 'discipline' | 'after-loss'
  label: string // short imperative
  detail: string // the numbers behind it
}

export interface NextMoveDeps {
  heroRole: (hero: string | null | undefined) => string
  heroDisplayName: (key: string) => string
  mapDisplayName: (key: string) => string
}

// Review advice applies below this coverage; a lift needs at least this
// much edge (and sample) to be worth prescribing.
const REVIEW_SHARE_CEILING = 0.2
const MIN_MOVE_SAMPLE = 10
const MIN_LIFT_EDGE = 0.04

export function nextMoves(
  records: readonly MatchRecord[],
  lift: readonly LiftRow[],
  deps: NextMoveDeps,
): NextMove[] {
  const candidates = [
    reviewMove(records),
    liftMove(lift, deps),
    sessionMove(records),
    disciplineMove(records, deps.heroRole),
    afterLossMove(records),
  ]
  return candidates.filter((m): m is NextMove => m !== null).slice(0, 3)
}

function reviewMove(records: readonly MatchRecord[]): NextMove | null {
  if (records.length < MIN_MOVE_SAMPLE) return null
  const reviewed = records.filter((r) => r.reviewed_at).length
  if (reviewed / records.length >= REVIEW_SHARE_CEILING) return null
  return {
    id: 'review',
    label: 'Review one of your games',
    detail: `${reviewed} of ${records.length} reviewed — the single biggest lever you control.`,
  }
}

const HELP_VERBS: Record<LiftRow['dimension'], (name: string) => string> = {
  hero: (n) => `Queue more ${n}`,
  map: (n) => `Favor ${n}`,
  mode: (n) => `Favor ${n} maps`,
  day: (n) => `Play more on ${n}s`,
  time: (n) => `Play more ${n} games`,
  teammate: (n) => `Duo with ${n}`,
}

const HURT_VERBS: Record<LiftRow['dimension'], (name: string) => string> = {
  hero: (n) => `Cut back on ${n}`,
  map: (n) => `Careful on ${n}`,
  mode: (n) => `Careful on ${n} maps`,
  day: (n) => `Watch your ${n} games`,
  time: (n) => `Watch your ${n} games`,
  teammate: (n) => `Rethink duos with ${n}`,
}

function liftMove(lift: readonly LiftRow[], deps: NextMoveDeps): NextMove | null {
  // liftTable arrives sorted by |lift − 1| desc, so the first qualifying
  // row IS the strongest condition worth acting on.
  const row = lift.find((r) => r.n >= MIN_MOVE_SAMPLE && Math.abs(r.lift - 1) >= MIN_LIFT_EDGE)
  if (!row) return null
  const name = row.dimension === 'hero'
    ? deps.heroDisplayName(row.key)
    : row.dimension === 'map' ? deps.mapDisplayName(row.key) : row.key
  const verb = row.lift > 1 ? HELP_VERBS[row.dimension] : HURT_VERBS[row.dimension]
  return {
    id: 'lift',
    label: verb(name),
    detail: `×${row.lift.toFixed(2)} your usual win rate over ${row.n} games.`,
  }
}

function sessionMove(records: readonly MatchRecord[]): NextMove | null {
  const b = winrateBySessionIndex(records)
  const first = b.buckets[0]
  const last = b.buckets[b.buckets.length - 1]
  if (!first || !last || last.winrate === null) return null
  if (first.sample < LOW_SAMPLE_N || last.sample < LOW_SAMPLE_N) return null

  const totalWins = b.buckets.reduce((s, x) => s + x.wins, 0)
  const totalN = b.buckets.reduce((s, x) => s + x.sample, 0)
  const baseline = Math.round((totalWins / totalN) * 100)
  if (last.winrate >= baseline - 5) return null

  const samples = meterMoveSamples(records)
  const atBase = expectedMeterDelta(samples, totalWins / totalN)
  const atLate = expectedMeterDelta(samples, last.winrate / 100)
  if (atBase === null || atLate === null || atBase - atLate < 0.5) return null
  return {
    id: 'session',
    label: 'End sessions one game earlier',
    detail: `You win ${last.winrate}% at game ${last.index}+ vs ${baseline}% overall — each game that deep costs ≈${(atBase - atLate).toFixed(1)}% meter.`,
  }
}

function disciplineMove(
  records: readonly MatchRecord[],
  heroRole: (hero: string | null | undefined) => string,
): NextMove | null {
  const split = analyzeHeroPool(records, DEFAULT_HERO_MEANINGFUL_PCT, heroRole).split
  if (split.out.decisive < LOW_SAMPLE_N) return null
  if (split.pure.winrate - split.out.winrate <= 5) return null
  return {
    id: 'discipline',
    label: 'Spend fewer ranked games off-pool',
    detail: `${split.pure.winrate}% on your pool vs ${split.out.winrate}% off it (${split.out.decisive} off-pool games) — practice in unranked.`,
  }
}

function afterLossMove(records: readonly MatchRecord[]): NextMove | null {
  const depth = winrateByStreakDepth(records)
  const first = depth.afterLoss[0]
  if (!first || first.winrate === null || first.sample < MIN_MOVE_SAMPLE) return null
  if (depth.baselineWinrate === null || first.winrate >= depth.baselineWinrate - 5) return null
  return {
    id: 'after-loss',
    label: 'Take a breath after a loss',
    detail: `You win ${first.winrate}% right after a loss vs ${depth.baselineWinrate}% baseline — that dip is yours to skip.`,
  }
}

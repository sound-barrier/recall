// The Elo Calculator's bootstrap season simulator. The closed-form models
// assume a symmetric ±m meter step; the player's rank cards record the
// ACTUAL signed moves — streak-amplified and asymmetric. Each simulated
// season draws a true win rate from the Beta posterior (parameter
// uncertainty) and then replays the season by resampling those real
// moves (path luck), which makes the outputs the most honest "play the
// season out" numbers the data supports. Deterministic by seed — no
// Math.random anywhere, so tests pin exact values and the UI doesn't
// flicker between recomputes.

import type { MatchRecord } from '@/api-client'
import { LADDER_MAX } from '@/match/elo-model'
import { betaQuantile, SKEPTIC_PRIOR, type BetaPrior } from '@/match/elo-bayes'

// mulberry32 is the standard tiny 32-bit PRNG — plenty for resampling.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface MeterSamples {
  winMoves: number[] // signed progress-% per won game (positive)
  lossMoves: number[] // …per lost game (negative)
}

// meterMoveSamples pools the player's own signed meter moves by result,
// under the same exclusions as the calculator's meter seeding (missing,
// exact zero, calibration). The magnitude is kept verbatim — streak
// amplification is exactly what the bootstrap should reproduce — but the
// SIGN comes from the result, so one mis-signed OCR read can't invert a
// step.
export function meterMoveSamples(recs: readonly Pick<MatchRecord, 'data'>[]): MeterSamples {
  const winMoves: number[] = []
  const lossMoves: number[] = []
  for (const rec of recs) {
    const d = rec.data
    const result = d?.result
    if (result !== 'victory' && result !== 'defeat') continue
    const cp = d?.change_percent
    if (typeof cp !== 'number' || cp === 0) continue
    if (d?.modifiers?.includes('calibration')) continue
    if (result === 'victory') winMoves.push(Math.abs(cp))
    else lossMoves.push(-Math.abs(cp))
  }
  return { winMoves, lossMoves }
}

// expectedMeterDelta is the mean signed meter move per game at win rate
// p, from the player's own pools — the number that prices behavioral
// advice ("one fewer late-session game ≈ +N% meter"). Null when either
// pool is under MIN_POOL (same trust floor as the simulator).
export function expectedMeterDelta(samples: MeterSamples, p: number): number | null {
  if (samples.winMoves.length < MIN_POOL || samples.lossMoves.length < MIN_POOL) return null
  const mean = (xs: number[]) => xs.reduce((s, v) => s + v, 0) / xs.length
  return p * mean(samples.winMoves) + (1 - p) * mean(samples.lossMoves)
}

// MIN_POOL: fewer real moves than this on either side and the bootstrap
// would just echo a handful of readings — fall back to the symmetric
// form value instead (and say so).
const MIN_POOL = 8

export interface SimInput {
  currentScore: number
  targetScore: number
  sampleWins: number
  sampleLosses: number
  horizonGames: number
  meter: MeterSamples | { symmetricPct: number }
  // Used when `meter` carries pools but one side is under MIN_POOL.
  symmetricFallbackPct?: number
  // Win-rate FRACTION lost per division climbed (ProjectionInput.decaySlope).
  // Applied per step: a season's win prob falls as its score rises above the
  // start, so simulated seasons plateau where the decay model says they
  // should — the one model every card shares. Default 0 = legacy behavior.
  decaySlope?: number
  // Hero what-if delta in POINTS (effective − measured rate). Shifts each
  // season's drawn win prob without touching the posterior's sample counts —
  // the dial moves projections, never the evidence about played games.
  rateShiftPts?: number
}

export interface SimOpts {
  sims?: number
  seed?: number
  checkpoints?: number
  prior?: BetaPrior
}

interface QuantileTriple {
  p10: number | null
  p50: number | null
  p90: number | null
}

export interface SeasonSim {
  probReachTarget: number
  probEndLower: number
  gamesToTarget: QuantileTriple // null where the never-mass swallows the quantile
  neverShare: number // share of seasons that never arrive within the horizon
  finalScore: { p10: number; p50: number; p90: number }
  fan: { games: number[]; p10: number[]; p50: number[]; p90: number[] }
  usedEmpiricalMeter: boolean
  sims: number
}

// simulateSeasons runs `sims` full seasons of `horizonGames` decisive
// games and reads the outcomes off as exact order statistics.
export function simulateSeasons(input: SimInput, opts: SimOpts = {}): SeasonSim {
  const sims = opts.sims ?? 4000
  const seed = opts.seed ?? 1
  const checkpoints = opts.checkpoints ?? 24
  const prior = opts.prior ?? SKEPTIC_PRIOR
  const rng = mulberry32(seed)

  const { winMoves, lossMoves, empirical } = resolveMeter(input)
  const alpha = prior.alpha + input.sampleWins
  const beta = prior.beta + input.sampleLosses
  const climbing = input.targetScore > input.currentScore
  // Repeated step/100 additions accumulate binary-float error (ten +0.2
  // steps land at 11.999999999999998); an epsilon keeps boundary hits
  // from reading one game late.
  const EPS = 1e-9

  // Checkpoint game indices (0 .. horizon, inclusive) for the fan —
  // deduped: a horizon shorter than the checkpoint count would repeat
  // indices, and the g === checkGames[check] walk only matches each game
  // number once, jamming every later checkpoint at the start score.
  const checkGames = [...new Set(Array.from({ length: checkpoints + 1 }, (_, i) =>
    Math.round((input.horizonGames * i) / checkpoints)))]

  const finals: number[] = []
  const hits: number[] = [] // games-to-target per season that reached it
  const checkScores: number[][] = checkGames.map(() => [])
  let reached = 0
  let endedLower = 0

  const slope = input.decaySlope ?? 0
  const shift = (input.rateShiftPts ?? 0) / 100
  const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

  for (let s = 0; s < sims; s++) {
    const pSeason = clamp01(betaQuantile(rng(), alpha, beta) + shift)
    let score = input.currentScore
    let hit = -1
    let check = 0
    for (let g = 0; g <= input.horizonGames; g++) {
      if (check < checkGames.length && g === checkGames[check]) {
        checkScores[check]!.push(score)
        check++
      }
      if (g === input.horizonGames) break
      // Tougher lobbies as you climb: the drawn form rate erodes by the
      // decay slope per division above the start (and recovers below it).
      const win = rng() < clamp01(pSeason - slope * (score - input.currentScore))
      const pool = win ? winMoves : lossMoves
      const step = pool[Math.floor(rng() * pool.length)] ?? 0
      score = Math.min(LADDER_MAX, Math.max(0, score + step / 100))
      if (hit < 0 && climbing && score >= input.targetScore - EPS) hit = g + 1
    }
    finals.push(score)
    if (hit >= 0) {
      reached++
      hits.push(hit)
    }
    if (score < input.currentScore - EPS) endedLower++
  }

  finals.sort((a, b) => a - b)
  hits.sort((a, b) => a - b)
  const neverShare = 1 - reached / sims

  // Games-to-target quantiles live on the FULL season distribution, where
  // the unreached tail sits at +∞: quantile q exists only when q < the
  // reached share.
  const hitQuantile = (q: number): number | null => {
    if (q >= reached / sims) return null
    return hits[Math.min(hits.length - 1, Math.floor(q * sims))] ?? null
  }
  const finalQuantile = (q: number): number =>
    finals[Math.min(finals.length - 1, Math.floor(q * finals.length))] ?? input.currentScore

  const fanQuantile = (scores: number[], q: number): number => {
    const sorted = [...scores].sort((a, b) => a - b)
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? input.currentScore
  }

  return {
    probReachTarget: reached / sims,
    probEndLower: endedLower / sims,
    gamesToTarget: { p10: hitQuantile(0.1), p50: hitQuantile(0.5), p90: hitQuantile(0.9) },
    neverShare,
    finalScore: { p10: finalQuantile(0.1), p50: finalQuantile(0.5), p90: finalQuantile(0.9) },
    fan: {
      games: checkGames,
      p10: checkScores.map((s) => fanQuantile(s, 0.1)),
      p50: checkScores.map((s) => fanQuantile(s, 0.5)),
      p90: checkScores.map((s) => fanQuantile(s, 0.9)),
    },
    usedEmpiricalMeter: empirical,
    sims,
  }
}

function resolveMeter(input: SimInput): { winMoves: number[]; lossMoves: number[]; empirical: boolean } {
  const symmetric = (pct: number) => ({ winMoves: [pct], lossMoves: [-pct], empirical: false })
  if ('symmetricPct' in input.meter) return symmetric(input.meter.symmetricPct)
  const { winMoves, lossMoves } = input.meter
  if (winMoves.length < MIN_POOL || lossMoves.length < MIN_POOL) {
    return symmetric(input.symmetricFallbackPct ?? meanAbs(winMoves, lossMoves))
  }
  return { winMoves, lossMoves, empirical: true }
}

function meanAbs(a: number[], b: number[]): number {
  const all = [...a, ...b].map(Math.abs)
  if (all.length === 0) return 21
  return all.reduce((s, v) => s + v, 0) / all.length
}

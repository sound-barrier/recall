// Seeds the Elo Calculator's editable inputs from the player's actual
// history, per rank track (OW2 keeps a separate rank per role-queue
// role plus one for open queue). Pure record-walking — the composable
// layer owns reactivity.

import type { MatchRecord } from '@/api-client'
import {
  TIER_ORDER, currentRankByRole, ladderScore, matchEpoch, roleBucket, type RankNow,
} from '@/match/match-trends-helpers'
import {
  analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT,
} from '@/match/match-hero-pool-helpers'
import { wilsonMargin } from '@/match/match-sample-helpers'
import { DEFAULT_METER_MOVE_PCT } from '@/match/elo-model'
import { logisticSlope } from '@/match/elo-stats'
import { shrunkWinRate } from '@/match/elo-bayes'

export type TrackKey = 'tank' | 'dps' | 'support' | 'open'

export const TRACK_LABELS: Record<TrackKey, string> = {
  tank: 'Tank',
  dps: 'DPS',
  support: 'Support',
  open: 'Open queue',
}

const TRACK_ORDER: readonly TrackKey[] = ['tank', 'dps', 'support', 'open']

type TrackInput = Pick<MatchRecord, 'match_key' | 'data' | 'queue_type' | 'play_mode'>

// PACE_WINDOW_DAYS bounds the games/week measurement to recent play,
// anchored on the track's latest match (not the wall clock) so a break
// from the game doesn't zero the pace.
const PACE_WINDOW_DAYS = 28
const DAY_MS = 24 * 60 * 60 * 1000
// meterMoveSamplesFloor: fewer qualifying rank readings than this and
// the per-game move falls back to the league-typical default.
const METER_SAMPLES_FLOOR = 3

// isCompetitive: the effective play mode (user override, else OCR
// playlist) — and a rank reading is definitionally competitive even
// when both mode fields are missing.
export function isCompetitive(rec: Pick<MatchRecord, 'play_mode' | 'data'>): boolean {
  if ((rec.play_mode ?? rec.data?.playlist) === 'competitive') return true
  return isRankBearing(rec)
}

function isRankBearing(rec: Pick<MatchRecord, 'data'>): boolean {
  const data = rec.data
  return !!data?.rank && (TIER_ORDER as readonly string[]).includes(data.rank) && typeof data.level === 'number'
}

// trackRecords narrows a corpus to one rank track's competitive matches
// (role queue splits by role; open queue is its own combined track).
export function trackRecords<T extends TrackInput>(records: readonly T[], track: TrackKey): T[] {
  return records.filter((r) => roleBucket(r).key === track && isCompetitive(r))
}

export interface TrackSeed {
  rank: RankNow | null
  currentScore: number | null
  wins: number
  losses: number
  winRate: number | null // decisive fraction; null with no decisive games
  meterMovePct: number
  meterSampleN: number
  gamesPerWeek: number | null
  decaySlope: MeasuredSlope | null // measured from the climb; null = use the default
}

// seedTrack derives every calculator input from one track's history.
export function seedTrack(records: readonly TrackInput[], track: TrackKey): TrackSeed {
  const recs = trackRecords(records, track)
  const rank = currentRankByRole(recs).find((r) => r.key === track) ?? null
  const { wins, losses } = decisiveTally(recs)
  const meter = measuredMeterMove(recs)
  return {
    rank,
    currentScore: rank ? ladderScore(rank.tier, rank.level, rank.progress) : null,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    meterMovePct: meter.pct,
    meterSampleN: meter.n,
    gamesPerWeek: measuredPace(recs),
    decaySlope: measuredDecaySlope(recs),
  }
}

export interface MeasuredSlope {
  pts: number // win-rate points lost per division climbed (can be ≤ 0 for an improver)
  lowerPts: number // 95% CI
  upperPts: number
  n: number // (score, result) pairs behind the fit
}

// SLOPE_MIN_PAIRS / SLOPE_MIN_SPREAD gate the regression: under 30
// paired games, or less than a division of rank movement, the slope
// isn't identifiable and the calculator keeps its default.
const SLOPE_MIN_PAIRS = 30
const SLOPE_MIN_SPREAD = 1

// measuredDecaySlope fits the player's own "how fast it gets harder":
// a logistic regression of each decisive result on the rank held when
// the game was played (the most recent PRE-match reading, carried
// forward), converted from logit units to win-rate points per division
// at the fitted mean rate — the local linearization the decay model
// actually uses. Null when the history can't identify a slope.
export function measuredDecaySlope(recs: readonly TrackInput[]): MeasuredSlope | null {
  const timed = recs
    .map((r) => ({ r, t: matchEpoch(r) }))
    .filter((x): x is { r: TrackInput; t: number } => x.t !== null)
    .sort((a, b) => a.t - b.t)

  const xs: number[] = []
  const wins: boolean[] = []
  let score: number | null = null
  for (const { r } of timed) {
    const d = r.data
    const result = d?.result
    if (score !== null && (result === 'victory' || result === 'defeat')) {
      xs.push(score)
      wins.push(result === 'victory')
    }
    if (d?.rank && typeof d.level === 'number') {
      const next = ladderScore(d.rank, d.level, d.rank_progress ?? 0)
      if (next !== null) score = next
    }
  }
  if (xs.length < SLOPE_MIN_PAIRS) return null
  if (Math.max(...xs) - Math.min(...xs) < SLOPE_MIN_SPREAD) return null

  const fit = logisticSlope(xs, wins)
  if (fit === null) return null
  // Logit slope → probability slope at the fitted centre (delta method).
  const scale = fit.meanRate * (1 - fit.meanRate)
  const s = -fit.slope * scale
  const half = 1.96 * fit.se * scale
  return { pts: s * 100, lowerPts: (s - half) * 100, upperPts: (s + half) * 100, n: fit.n }
}

function decisiveTally(recs: readonly TrackInput[]): { wins: number; losses: number } {
  let wins = 0
  let losses = 0
  for (const r of recs) {
    if (r.data?.result === 'victory') wins++
    else if (r.data?.result === 'defeat') losses++
  }
  return { wins, losses }
}

// measuredMeterMove is the mean |change_percent| over the track's rank
// readings — the player's own per-game meter speed. Calibration
// readings and exact zeroes (demotion protection / missing) are
// excluded; too few samples falls back to the default; clamped to a
// sane band so one mis-OCR'd promotion can't distort the model.
function measuredMeterMove(recs: readonly TrackInput[]): { pct: number; n: number } {
  const samples: number[] = []
  for (const r of recs) {
    const cp = r.data?.change_percent
    if (typeof cp !== 'number' || cp === 0) continue
    if (r.data?.modifiers?.includes('calibration')) continue
    samples.push(Math.abs(cp))
  }
  if (samples.length < METER_SAMPLES_FLOOR) return { pct: DEFAULT_METER_MOVE_PCT, n: samples.length }
  const mean = samples.reduce((s, v) => s + v, 0) / samples.length
  return { pct: Math.min(40, Math.max(5, mean)), n: samples.length }
}

// measuredPace is decisive games per week over the last PACE_WINDOW_DAYS
// of play, anchored on the latest match. A history shorter than the
// window uses its real span (floored at a week so two busy days don't
// read as a 70-games/week pace).
function measuredPace(recs: readonly TrackInput[]): number | null {
  const timed = recs
    .map((r) => ({ epoch: matchEpoch(r), decisive: r.data?.result === 'victory' || r.data?.result === 'defeat' }))
    .filter((x): x is { epoch: number; decisive: boolean } => x.epoch !== null)
  if (timed.length === 0) return null
  const latest = Math.max(...timed.map((x) => x.epoch))
  const earliest = Math.min(...timed.map((x) => x.epoch))
  const windowStart = latest - PACE_WINDOW_DAYS * DAY_MS
  const count = timed.filter((x) => x.decisive && x.epoch >= windowStart).length
  if (count === 0) return null
  const spanDays = Math.min(PACE_WINDOW_DAYS, Math.max(7, (latest - earliest) / DAY_MS))
  return (7 * count) / spanDays
}

export interface AvailableTrack {
  key: TrackKey
  label: string
  hasRank: boolean
  decisiveN: number
}

// availableTracks summarizes each track for the segmented picker and
// names the best default: the most-played track that has a rank
// reading, else the most-played overall.
export function availableTracks(records: readonly TrackInput[]): { tracks: AvailableTrack[]; defaultTrack: TrackKey } {
  const tracks = TRACK_ORDER.map((key) => {
    const recs = trackRecords(records, key)
    const { wins, losses } = decisiveTally(recs)
    return { key, label: TRACK_LABELS[key], hasRank: recs.some(isRankBearing), decisiveN: wins + losses }
  })
  const ranked = tracks.filter((t) => t.hasRank)
  const pool = ranked.length > 0 ? ranked : tracks
  const best = pool.reduce((a, b) => (b.decisiveN > a.decisiveN ? b : a))
  return { tracks, defaultTrack: best.key }
}

export interface HeroPickStat {
  key: string
  role: string
  wins: number
  losses: number
  winrate: number // integer %, decisive-only (house convention)
  adjustedWinrate: number | null // empirical-Bayes: shrunk toward the pooled rate
  marginPts: number | null // Wilson ± in percentage points
  inPool: boolean
  lowSample: boolean
}

// heroPickerStats lists every meaningfully-played hero on the track with
// its record and pool membership — straight off analyzeHeroPool (the
// pool ∪ out-of-pool sets already carry all the tallies). Each hero also
// gets an adjusted rate shrunk toward the pooled record ("the player is
// the constant"): a hot 3–0 reads near the pool, a long record barely
// moves. In-pool heroes first, then by sample size.
export function heroPickerStats(
  trackRecs: readonly Pick<MatchRecord, 'data'>[],
  heroRole: (hero: string | null | undefined) => string,
): HeroPickStat[] {
  const analysis = analyzeHeroPool(trackRecs, DEFAULT_HERO_MEANINGFUL_PCT, heroRole)
  const rows = [
    ...analysis.pool.map((h) => ({ ...h, inPool: true })),
    ...analysis.outHeroes.map((h) => ({ ...h, inPool: false })),
  ]
  const poolWins = rows.reduce((s, h) => s + h.wins, 0)
  const poolLosses = rows.reduce((s, h) => s + h.losses, 0)
  return rows
    .map((h) => {
      const adjusted = shrunkWinRate(h.wins, h.losses, poolWins, poolLosses)
      return {
        key: h.key,
        role: h.role,
        wins: h.wins,
        losses: h.losses,
        winrate: h.winrate,
        adjustedWinrate: adjusted === null ? null : Math.round(adjusted * 100),
        marginPts: wilsonMargin(h.wins, h.wins + h.losses),
        inPool: h.inPool,
        lowSample: h.lowSample,
      }
    })
    .sort((a, b) => Number(b.inPool) - Number(a.inPool) || (b.wins + b.losses) - (a.wins + a.losses))
}

// pooledWinLoss sums the selected heroes' decisive records — the "what
// if I only queued these heroes" sample. A multi-hero match credits
// each selected hero once (per-hero rates, same as the hero widgets).
export function pooledWinLoss(
  stats: readonly HeroPickStat[],
  selected: ReadonlySet<string>,
): { wins: number; losses: number } {
  let wins = 0
  let losses = 0
  for (const s of stats) {
    if (!selected.has(s.key)) continue
    wins += s.wins
    losses += s.losses
  }
  return { wins, losses }
}

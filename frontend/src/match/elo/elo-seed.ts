// Seeds the Elo Calculator's editable inputs from the player's actual
// history, per rank track (OW2 keeps a separate rank per role-queue
// role plus one for open queue). Pure record-walking — the composable
// layer owns reactivity.

import type { MatchRecord } from '@/api-client'
import {
  TIER_ORDER, currentRankByRole, isPlaceableRank, ladderScore, matchEpoch, roleBucket, type RankNow,
} from '@/match/trends/match-trends-helpers'
import {
  analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT, meaningfulHeroes,
} from '@/match/dossier/match-hero-pool-helpers'
import { wilsonMargin } from '@/match/dossier/match-sample-helpers'
import { DEFAULT_METER_MOVE_PCT } from '@/match/elo/elo-model'
import { logisticSlope } from '@/match/elo/elo-stats'
import { shrunkWinRate } from '@/match/elo/elo-bayes'

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

// PercentileTrail is the user's OWN standing, and how it moved.
//
// The card this feeds was deleted once (a928122f) because it was built on a
// published population distribution that season 4's Rank Redistribution voided.
// Nothing replaces that distribution — so this reports only what the player's
// screenshots actually said: where they stand now, and where they stood before.
//
// `previous` is paired ONLY within the same season, which is the whole lesson of
// that deletion: a redistribution moves everyone, so a percentile either side of
// a boundary measures two different populations and the difference is not a
// climb. Unpairable stays null rather than 0 — "no comparison available" is not
// "you did not move".
interface PercentileTrail {
  now: number
  // The rank the LATEST reading was printed against. A percentile is a
  // statement about a SPECIFIC rank, and the newest capture carrying a caption
  // can be older than the newest rank reading — so quoting the number beside
  // the calculator's current rank would attach it to a rank it never measured.
  nowRank: string | null
  previous: number | null
  deltaPts: number | null
  // Readings in the SAME season as the latest — the ones this trail is entitled
  // to compare. Counting every reading would advertise a sample it refused to
  // use.
  comparableN: number
  n: number
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
  percentileTrail: PercentileTrail | null
}

// seedTrack derives every calculator input from one track's history.
export function seedTrack(
  records: readonly TrackInput[],
  track: TrackKey,
  // Injected rather than imported so this module stays free of season fixtures,
  // the same shape heroRole / mapGameMode already use. Default resolver pairs
  // nothing, which is the safe answer when the caller knows no seasons.
  seasonKeyOf: (rec: TrackInput) => string | null = () => null,
): TrackSeed {
  const recs = trackRecords(records, track)
  const rank = currentRankByRole(recs).find((r) => r.key === track) ?? null
  const { wins, losses } = decisiveTally(recs)
  const meter = measuredMeterMove(recs)
  return {
    rank,
    // An unread progress seeds at the division boundary: the calculator needs a
    // position to start from, and 0 is the honest floor of the division we do
    // know. It is a model input, not a reading shown to the user.
    currentScore: rank ? ladderScore(rank.tier, rank.level, rank.progress ?? 0) : null,
    wins,
    losses,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    meterMovePct: meter.pct,
    meterSampleN: meter.n,
    gamesPerWeek: measuredPace(recs),
    decaySlope: measuredDecaySlope(recs),
    percentileTrail: percentileTrail(recs, seasonKeyOf),
  }
}

// percentileTrail reads the track's percentile-bearing captures newest-first.
//
// Only post-placement rank screens report the caption, so this is sparse by
// nature — most tracks will have none, and one reading is a common answer.
function percentileTrail(
  recs: readonly TrackInput[],
  seasonKeyOf: (rec: TrackInput) => string | null,
): PercentileTrail | null {
  const readings = recs
    .filter((r) => isPlaceableRank(r.data) && typeof r.data?.rank_percentile === 'number')
    .map((r) => ({ rec: r, t: matchEpoch(r) ?? 0, pct: r.data?.rank_percentile as number }))
    .sort((a, b) => a.t - b.t)
  if (readings.length === 0) return null

  const latest = readings[readings.length - 1]!
  const previous = pairableEarlier(readings, latest, seasonKeyOf)
  const key = seasonKeyOf(latest.rec)
  const comparable = key === null
    ? 1
    : readings.filter((r) => seasonKeyOf(r.rec) === key).length
  const d = latest.rec.data
  const rank = d?.rank && typeof d?.level === 'number' ? `${d.rank} ${d.level}` : null
  return {
    now: latest.pct,
    nowRank: rank,
    previous: previous?.pct ?? null,
    deltaPts: previous ? latest.pct - previous.pct : null,
    comparableN: comparable,
    n: readings.length,
  }
}

// pairableEarlier finds the oldest reading that is comparable to the newest —
// same season, so no redistribution sits between them.
function pairableEarlier<T extends TrackInput>(
  readings: readonly { rec: T; t: number; pct: number }[],
  latest: { rec: T; t: number; pct: number },
  seasonKeyOf: (rec: T) => string | null,
): { pct: number } | null {
  const key = seasonKeyOf(latest.rec)
  if (key === null) return null
  for (const r of readings) {
    if (r === latest) break
    if (seasonKeyOf(r.rec) === key) return r
  }
  return null
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
// A record's own rank reading in ladder units, or null when it
// carries none.
function rankReading(d: TrackInput['data']): number | null {
  if (!d?.rank || typeof d.level !== 'number') return null
  return ladderScore(d.rank, d.level, d.rank_progress ?? 0)
}

// Pair each decisive result with the most recent PRE-match rank
// reading, carried forward from earlier games.
function pairResultsWithRank(timed: { r: TrackInput }[]): { xs: number[]; wins: boolean[] } {
  const xs: number[] = []
  const wins: boolean[] = []
  let score: number | null = null
  for (const { r } of timed) {
    const result = r.data?.result
    if (score !== null && (result === 'victory' || result === 'defeat')) {
      xs.push(score)
      wins.push(result === 'victory')
    }
    const next = rankReading(r.data)
    if (next !== null) score = next
  }
  return { xs, wins }
}

export function measuredDecaySlope(recs: readonly TrackInput[]): MeasuredSlope | null {
  const timed = recs
    .map((r) => ({ r, t: matchEpoch(r) }))
    .filter((x): x is { r: TrackInput; t: number } => x.t !== null)
    .sort((a, b) => a.t - b.t)

  const { xs, wins } = pairResultsWithRank(timed)
  if (xs.length < SLOPE_MIN_PAIRS) return null
  if (Math.max(...xs) - Math.min(...xs) < SLOPE_MIN_SPREAD) return null

  const fit = logisticSlope(xs, wins)
  if (fit === null) return null
  // Logit slope → probability slope at the fitted center (delta method).
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
      const adjusted = shrunkWinRate(h.wins, h.losses, { wins: poolWins, losses: poolLosses })
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

// pooledDecisiveMatches counts the REAL decisive matches whose meaningful
// heroes intersect the selection. A multi-hero match rightly credits every
// hero's RATE, but it is still one game of evidence — pooled per-hero sums
// exceed it, and a sample size that exceeds the games actually played
// narrows every downstream interval beyond what the data supports. This is
// the honest cap.
export function pooledDecisiveMatches(
  records: readonly MatchRecord[],
  selected: ReadonlySet<string>,
  thresholdPct = DEFAULT_HERO_MEANINGFUL_PCT,
): number {
  let n = 0
  for (const rec of records) {
    const result = rec.data?.result
    if (result !== 'victory' && result !== 'defeat') continue
    if (meaningfulHeroes(rec, thresholdPct).some((h) => selected.has(h))) n++
  }
  return n
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

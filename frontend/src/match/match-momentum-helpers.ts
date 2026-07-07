// Behavioural analytics over the time-ordered match set: tilt/momentum
// (win-rate conditioned on the previous result, session-opener win-rate)
// and climb/session stats (net rank movement, leaver rate, play-session
// count). Pure + unit-tested; the dossier wraps these as computeds.
//
// Sibling helpers: match-trends-helpers.ts (matchEpoch + role/rank),
// match-time-helpers.ts (game-length parsing).

import type { MatchRecord } from '@/api-client'
import { matchEpoch } from '@/match/match-trends-helpers'

// A gap longer than this between consecutive matches starts a new play
// session. Three hours comfortably separates evening sessions from the
// next day without splitting a bathroom break mid-grind. Exported so
// the list's session grouping splits on the SAME rule the momentum
// widgets count by.
export const SESSION_GAP_HOURS = 3

const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

export type MomentumInput = Pick<MatchRecord, 'match_key' | 'data' | 'annotation'>

// A conditioned win-rate plus the sample it was computed over, so the
// widget can show "67% (over 9 games)" and render '—' when the sample
// is empty.
export interface RateSample {
  winrate: number | null
  sample: number
}

// Decisive matches (victory / defeat) in chronological order, paired
// with their epoch. Draws are dropped — they don't move win-rate and
// muddy "the game after a loss".
function decisiveSequence(records: readonly MomentumInput[]): { t: number; win: boolean }[] {
  const seq: { t: number; win: boolean }[] = []
  for (const rec of records) {
    const result = rec.data?.result
    if (result !== 'victory' && result !== 'defeat') continue
    const t = matchEpoch(rec)
    if (t == null) continue
    seq.push({ t, win: result === 'victory' })
  }
  seq.sort((a, b) => a.t - b.t)
  return seq
}

// Win-rate of the match immediately following a `prev`-result match —
// the tilt signal (win-rate after a loss) and its warm baseline
// (win-rate after a win).
export function winrateAfterResult(records: readonly MomentumInput[], prev: 'victory' | 'defeat'): RateSample {
  const seq = decisiveSequence(records)
  const wantPrevWin = prev === 'victory'
  let wins = 0
  let n = 0
  for (let i = 1; i < seq.length; i++) {
    if (seq[i - 1]!.win !== wantPrevWin) continue
    n++
    if (seq[i]!.win) wins++
  }
  return { winrate: n === 0 ? null : Math.round((wins / n) * 100), sample: n }
}

// Win-rate of session-opening matches — the first decisive game of each
// play session (a gap > gapHours since the previous decisive game, or
// the very first game). Surfaces warm-up effects.
export function firstGameOfSessionWinrate(records: readonly MomentumInput[], gapHours = SESSION_GAP_HOURS): RateSample {
  const seq = decisiveSequence(records)
  const gapMs = gapHours * HOUR_MS
  let wins = 0
  let n = 0
  for (let i = 0; i < seq.length; i++) {
    const opensSession = i === 0 || seq[i]!.t - seq[i - 1]!.t > gapMs
    if (!opensSession) continue
    n++
    if (seq[i]!.win) wins++
  }
  return { winrate: n === 0 ? null : Math.round((wins / n) * 100), sample: n }
}

// Net rank-meter movement over the last `sinceDays` days OF PLAY
// (anchored on the most recent match, not wall-clock, so it reads as
// "recent climb" regardless of when you open the app). Sums the signed
// per-match `change_percent`. In role queue this aggregates movement
// across all roles.
export function netRankProgress(records: readonly MomentumInput[], sinceDays: number): number {
  const timed: { rec: MomentumInput; t: number }[] = []
  for (const rec of records) {
    const t = matchEpoch(rec)
    if (t != null) timed.push({ rec, t })
  }
  if (timed.length === 0) return 0
  const latest = Math.max(...timed.map((x) => x.t))
  const cutoff = latest - sinceDays * DAY_MS
  let sum = 0
  for (const { rec, t } of timed) {
    if (t >= cutoff) sum += rec.data?.change_percent ?? 0
  }
  return sum
}

// Share of matches flagged with a leaver (any side). `rate` is null on
// an empty set so the widget shows '—' rather than 0%.
export interface LeaverRate {
  rate: number | null
  leaverCount: number
  total: number
}

export function leaverRate(records: readonly MomentumInput[]): LeaverRate {
  let leaverCount = 0
  let total = 0
  for (const rec of records) {
    total++
    if (rec.annotation?.leaver) leaverCount++
  }
  return { rate: total === 0 ? null : Math.round((leaverCount / total) * 100), leaverCount, total }
}

// Number of distinct play sessions — runs of matches separated by a gap
// longer than gapHours. Untimed matches are ignored.
export function sessionCount(records: readonly MomentumInput[], gapHours = SESSION_GAP_HOURS): number {
  const times: number[] = []
  for (const rec of records) {
    const t = matchEpoch(rec)
    if (t != null) times.push(t)
  }
  if (times.length === 0) return 0
  times.sort((a, b) => a - b)
  const gapMs = gapHours * HOUR_MS
  let sessions = 1
  for (let i = 1; i < times.length; i++) {
    if (times[i]! - times[i - 1]! > gapMs) sessions++
  }
  return sessions
}

// ── Tilt nudge ──────────────────────────────────────────────────────
//
// Two-pronged trigger (deliberately strict so it never moralises on a
// single bad day): the LATEST >=3 timed matches are all defeats, AND
// the loss-streak K/D collapsed more than 25% below the 30-day
// baseline (which needs >=5 matches to mean anything). Assists count
// toward neither side; deaths floor at 1 so a deathless baseline
// can't divide by zero.

const TILT_MIN_LOSSES = 3
const TILT_KD_DROP = 0.75
const TILT_BASELINE_DAYS = 30
const TILT_BASELINE_MIN_SAMPLE = 5

export interface TiltNudgeSignal {
  losses: number
  // Percent the streak K/D sits below the baseline, rounded.
  dropPercent: number
  // The streak's first loss — the dismissal key: the same streak never
  // re-nudges, a new streak may.
  streakKey: string
}

function kd(records: readonly MomentumInput[]): number | null {
  let elims = 0
  let deaths = 0
  let sampled = 0
  for (const r of records) {
    const d = r.data ?? {}
    if (d.eliminations == null && d.deaths == null) continue
    sampled++
    elims += d.eliminations ?? 0
    deaths += d.deaths ?? 0
  }
  if (sampled === 0) return null
  return elims / Math.max(1, deaths)
}

export function tiltNudgeSignal(records: readonly MomentumInput[]): TiltNudgeSignal | null {
  const timed = records
    .map(r => ({ r, t: matchEpoch(r) }))
    .filter((x): x is { r: MomentumInput, t: number } => x.t != null)
    .sort((a, b) => a.t - b.t)
  if (timed.length < TILT_MIN_LOSSES + TILT_BASELINE_MIN_SAMPLE) return null

  const streak: MomentumInput[] = []
  for (let i = timed.length - 1; i >= 0; i--) {
    if (timed[i]!.r.data?.result !== 'defeat') break
    streak.unshift(timed[i]!.r)
  }
  if (streak.length < TILT_MIN_LOSSES) return null

  const latest = timed[timed.length - 1]!.t
  const floor = latest - TILT_BASELINE_DAYS * 24 * HOUR_MS
  const baselinePool = timed
    .slice(0, timed.length - streak.length)
    .filter(x => x.t >= floor)
    .map(x => x.r)
  if (baselinePool.length < TILT_BASELINE_MIN_SAMPLE) return null

  const streakKD = kd(streak)
  const baseKD = kd(baselinePool)
  if (streakKD == null || baseKD == null || baseKD <= 0) return null
  if (streakKD > baseKD * TILT_KD_DROP) return null

  return {
    losses: streak.length,
    dropPercent: Math.round((1 - streakKD / baseKD) * 100),
    streakKey: streak[0]!.match_key,
  }
}

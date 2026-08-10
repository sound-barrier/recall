// Behavioral analytics over the time-ordered match set: tilt/momentum
// (win-rate conditioned on the previous result, session-opener win-rate)
// and climb/session stats (net rank movement, leaver rate, play-session
// count). Pure + unit-tested; the dossier wraps these as computeds.
//
// Sibling helpers: match-trends-helpers.ts (matchEpoch + role/rank),
// match-time-helpers.ts (game-length parsing).

import type { MatchRecord } from '@/api-client'
import { matchEpoch } from '@/match/match-trends-helpers'
import { logisticSlope, type LogisticSlopeFit } from '@/match/elo-stats'

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

// The recent-form read: win-rate over the last `window` decisive games
// against the overall rate, with the signed gap in percentage points.
// Answers "am I trending up or down right now" at a glance.
export interface FormDelta {
  recent: RateSample
  overall: RateSample
  deltaPts: number | null
}

export function formDelta(records: readonly MomentumInput[], window: number): FormDelta {
  const seq = decisiveSequence(records)
  const rate = (games: readonly { win: boolean }[]): RateSample => {
    const wins = games.filter((g) => g.win).length
    return { winrate: games.length === 0 ? null : Math.round((wins / games.length) * 100), sample: games.length }
  }
  const overall = rate(seq)
  const recent = rate(seq.slice(-window))
  return {
    recent,
    overall,
    deltaPts: recent.winrate === null || overall.winrate === null
      ? null
      : recent.winrate - overall.winrate,
  }
}

// Win-rate of games played right after `minStreak`+ consecutive losses —
// the stop-loss signal. Sharper than the single-loss tilt check: two
// losses in a row is where "one more game" starts costing rank.
export function winrateAfterLossStreak(records: readonly MomentumInput[], minStreak: number): RateSample {
  const seq = decisiveSequence(records)
  let losses = 0
  let wins = 0
  let n = 0
  for (const game of seq) {
    if (losses >= minStreak) {
      n++
      if (game.win) wins++
    }
    losses = game.win ? 0 : losses + 1
  }
  return { winrate: n === 0 ? null : Math.round((wins / n) * 100), sample: n }
}

interface SessionIndexBucket {
  index: number // 1-based; the last bucket pools maxIndex and deeper
  winrate: number | null // integer %, null with no sample
  wins: number
  sample: number
}

export interface SessionIndexBreakdown {
  buckets: SessionIndexBucket[]
  slope: LogisticSlopeFit | null // logit per game-index; null under the fit floor
  sessions: number
}

// winrateBySessionIndex is the session-hygiene curve: the next-game win
// rate bucketed by how deep into a play session the game was (1, 2, 3,
// maxIndex+). Where the late buckets sag is where stopping earlier starts
// paying. The slope fit (index vs result, index capped to bound leverage)
// supplies the "is the sag real?" p-value.
export function winrateBySessionIndex(
  records: readonly MomentumInput[],
  opts: { maxIndex?: number; gapHours?: number } = {},
): SessionIndexBreakdown {
  const maxIndex = opts.maxIndex ?? 4
  const gapMs = (opts.gapHours ?? SESSION_GAP_HOURS) * HOUR_MS
  const seq = decisiveSequence(records)

  const tallies = Array.from({ length: maxIndex }, (_, i) => ({ index: i + 1, wins: 0, sample: 0 }))
  const xs: number[] = []
  const wins: boolean[] = []
  let sessions = 0
  let idx = 0
  for (let i = 0; i < seq.length; i++) {
    const opensSession = i === 0 || seq[i]!.t - seq[i - 1]!.t > gapMs
    idx = opensSession ? 1 : idx + 1
    if (opensSession) sessions++
    const bucket = tallies[Math.min(idx, maxIndex) - 1]!
    bucket.sample++
    if (seq[i]!.win) bucket.wins++
    xs.push(Math.min(idx, maxIndex + 2))
    wins.push(seq[i]!.win)
  }
  return {
    buckets: tallies.map((b) => ({
      index: b.index,
      winrate: b.sample === 0 ? null : Math.round((b.wins / b.sample) * 100),
      wins: b.wins,
      sample: b.sample,
    })),
    slope: logisticSlope(xs, wins),
    sessions,
  }
}

// Win-rate of session-opening matches — the first decisive game of each
// play session (a gap > gapHours since the previous decisive game, or
// the very first game). Surfaces warm-up effects.
export interface BreakRust {
  breaks: number // gaps of gapDays+ between consecutive decisive games
  back: RateSample // the first `window` decisive games after each gap
  rest: RateSample // every other decisive game
}

// breakRust measures what a layoff costs: split the decisive sequence at
// every gap of gapDays+ calendar days and compare the first `window` games
// back against everything else. Rust is real for most players — and the
// counter is consistency, not talent.
export function breakRust(
  records: readonly MomentumInput[],
  opts: { gapDays?: number; window?: number } = {},
): BreakRust {
  const gapMs = (opts.gapDays ?? 7) * 24 * HOUR_MS
  const window = opts.window ?? 8
  const seq = decisiveSequence(records)
  let breaks = 0
  let backLeft = 0
  const back = { wins: 0, n: 0 }
  const rest = { wins: 0, n: 0 }
  for (let i = 0; i < seq.length; i++) {
    if (i > 0 && seq[i]!.t - seq[i - 1]!.t >= gapMs) {
      breaks++
      backLeft = window
    }
    const bucket = backLeft > 0 ? back : rest
    if (backLeft > 0) backLeft--
    bucket.n++
    if (seq[i]!.win) bucket.wins++
  }
  const rate = (b: { wins: number; n: number }): RateSample =>
    ({ winrate: b.n === 0 ? null : Math.round((b.wins / b.n) * 100), sample: b.n })
  return { breaks, back: rate(back), rest: rate(rest) }
}

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
    if (rec.annotation?.leavers?.length) leaverCount++
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
// Two-pronged trigger (deliberately strict so it never moralizes on a
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

type TimedMatch = { r: MomentumInput; t: number }

// Records that can place themselves in time, oldest-first.
function timedSorted(records: readonly MomentumInput[]): TimedMatch[] {
  return records
    .map(r => ({ r, t: matchEpoch(r) }))
    .filter((x): x is TimedMatch => x.t != null)
    .sort((a, b) => a.t - b.t)
}

// The trailing all-defeat run, oldest-first.
function trailingLossStreak(timed: TimedMatch[]): MomentumInput[] {
  const streak: MomentumInput[] = []
  for (let i = timed.length - 1; i >= 0; i--) {
    if (timed[i]!.r.data?.result !== 'defeat') break
    streak.unshift(timed[i]!.r)
  }
  return streak
}

export function tiltNudgeSignal(records: readonly MomentumInput[]): TiltNudgeSignal | null {
  const timed = timedSorted(records)
  if (timed.length < TILT_MIN_LOSSES + TILT_BASELINE_MIN_SAMPLE) return null

  const streak = trailingLossStreak(timed)
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

// ── Session summary ─────────────────────────────────────────────────
//
// The freshest play session's tally, but only while it's ACTIVE: the
// latest timed match must sit within the session gap of `now`. A
// re-parse of an old backlog therefore never reads as "session so
// far" — sessions are about what's happening tonight, not history.

export interface SessionSummary {
  matches: number
  w: number
  l: number
  d: number
}

// The trailing run of games spaced closer than the session gap,
// newest included, oldest-first.
function trailingSession(timed: TimedMatch[], gapMs: number): TimedMatch[] {
  const session = [timed[timed.length - 1]!]
  for (let i = timed.length - 2; i >= 0; i--) {
    if (session[0]!.t - timed[i]!.t > gapMs) break
    session.unshift(timed[i]!)
  }
  return session
}

export function currentSessionSummary(
  records: readonly MomentumInput[],
  now: number = Date.now(),
  gapHours: number = SESSION_GAP_HOURS,
): SessionSummary | null {
  const timed = timedSorted(records)
  if (timed.length === 0) return null

  const gapMs = gapHours * HOUR_MS
  if (now - timed[timed.length - 1]!.t > gapMs) return null

  const session = trailingSession(timed, gapMs)
  const sum: SessionSummary = { matches: session.length, w: 0, l: 0, d: 0 }
  for (const { r } of session) {
    const res = r.data?.result
    if (res === 'victory') sum.w++
    else if (res === 'defeat') sum.l++
    else if (res === 'draw') sum.d++
  }
  return sum
}

import { matchEpoch } from '@/match/trends/match-trends-helpers'
import { normalCdf } from '@/match/elo/elo-stats'
import { sessionCount, type MomentumInput } from '@/match/dossier/match-momentum-helpers'

// Self-comparison over a trailing window: "is this week different from my own
// normal, and is the difference big enough to mean anything?"
//
// Every helper here compares the player against THEMSELVES. That is the whole
// design constraint — the app has no population model, and the one card that
// assumed it had one had to be deleted when the ladder was redistributed.

const DAY_MS = 86_400_000

// Below this, a difference is arithmetic rather than evidence. Copied from the
// expected-cell rule the chi-square helper already applies rather than invented:
// a handful of games will happily produce a 20-point "swing" that is noise.
const MIN_SAMPLE = 8

// Share of a window's matches that must actually report a movement before their
// sum is allowed to stand for the window. One legible pill out of twenty
// describes those captures, not the week.
const RANK_COVERAGE = 0.5

export interface Windows<T> {
  recent: T[]
  baseline: T[]
}

/**
 * Split records into a recent window and the baseline BEFORE it.
 *
 * The windows are disjoint on purpose. Comparing the last 7 days against a
 * 30-day window that CONTAINS them makes the sample a subset of its own
 * reference, which drags every z toward zero and quietly under-reports real
 * change. Both are half-open and anchored on the newest match rather than on
 * wall-clock now, so a player who has not played since Tuesday still gets
 * "their last week" instead of an empty one.
 */
export function splitTrailingWindow<T extends MomentumInput>(
  records: readonly T[],
  recentDays: number,
  baselineDays: number,
): Windows<T> {
  const timed = records
    .map((rec) => ({ rec, t: matchEpoch(rec) }))
    .filter((x): x is { rec: T; t: number } => x.t != null)
  if (timed.length === 0) return { recent: [], baseline: [] }

  const anchor = Math.max(...timed.map((x) => x.t))
  const recentFrom = anchor - recentDays * DAY_MS
  const baselineFrom = anchor - (recentDays + baselineDays) * DAY_MS
  return {
    recent: timed.filter((x) => x.t >= recentFrom).map((x) => x.rec),
    baseline: timed.filter((x) => x.t < recentFrom && x.t >= baselineFrom).map((x) => x.rec),
  }
}

function decisive(records: readonly MomentumInput[]): { wins: number; total: number } {
  let wins = 0
  let total = 0
  for (const r of records) {
    const res = r.data?.result
    if (res !== 'victory' && res !== 'defeat') continue
    total++
    if (res === 'victory') wins++
  }
  return { wins, total }
}

/**
 * How this window's win rate compares to the player's own baseline.
 *
 * `sigma` is the standardized difference, reported instead of a raw percentage
 * gap because a 3-match sample swinging 20 points is not the same event as a
 * 40-match sample moving 6 — and the raw gap says they are. `null` below the
 * sample floor is a refusal to answer, not a zero.
 */
export interface BaselineDelta {
  recentRate: number | null
  baselineRate: number | null
  sigma: number | null
  pValue: number | null
  recentN: number
  baselineN: number
}

export function winrateVsBaseline(
  records: readonly MomentumInput[],
  opts: { recentDays: number; baselineDays: number } = { recentDays: 7, baselineDays: 30 },
): BaselineDelta {
  const { recent, baseline } = splitTrailingWindow(records, opts.recentDays, opts.baselineDays)
  const r = decisive(recent)
  const b = decisive(baseline)
  const recentRate = r.total > 0 ? r.wins / r.total : null
  const baselineRate = b.total > 0 ? b.wins / b.total : null

  if (recentRate === null || baselineRate === null || r.total < MIN_SAMPLE || b.total < MIN_SAMPLE) {
    return { recentRate, baselineRate, sigma: null, pValue: null, recentN: r.total, baselineN: b.total }
  }
  // Two-proportion z. The baseline is the reference, so its rate supplies the
  // expected value and the pooled rate the variance.
  const pooled = (r.wins + b.wins) / (r.total + b.total)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / r.total + 1 / b.total))
  if (se === 0) {
    return { recentRate, baselineRate, sigma: null, pValue: null, recentN: r.total, baselineN: b.total }
  }
  const z = (recentRate - baselineRate) / se
  return {
    recentRate,
    baselineRate,
    sigma: z,
    pValue: 2 * (1 - normalCdf(Math.abs(z))),
    recentN: r.total,
    baselineN: b.total,
  }
}

export type ClimbVerdict = 'deflation' | 'lucky' | 'matched' | 'unknown'

/**
 * judgeClimb compares how the player PLAYED against how the ladder MOVED.
 *
 * Split out so performanceVsRank stays inside the complexity cap, and because
 * the thresholds are a judgment worth reading on their own: a rank that moved
 * against a clearly better-than-baseline week is the "deflation" the player
 * suspects, and the reverse is the luck they usually do not notice.
 */
export function judgeClimb(sigma: number | null, netPercent: number | null): ClimbVerdict {
  if (sigma === null || netPercent === null) return 'unknown'
  const playedBetter = sigma > 1
  const playedWorse = sigma < -1
  if (playedBetter && netPercent <= 0) return 'deflation'
  if (playedWorse && netPercent > 0) return 'lucky'
  return 'matched'
}

export interface PerformanceVsRank {
  delta: BaselineDelta
  netPercent: number | null
  readCount: number
  readOf: number // matches in the window, so a surface can say "4 of 19 read"
  verdict: ClimbVerdict
}

/**
 * Did the rank movement match the play?
 *
 * netPercent is null — not 0 — when no capture in the window reported a
 * movement. Reading an unread pill as "the rank did not move" is exactly how
 * this widget would invent deflation that never happened.
 */
export function performanceVsRank(
  records: readonly MomentumInput[],
  opts: { recentDays: number; baselineDays: number } = { recentDays: 7, baselineDays: 30 },
): PerformanceVsRank {
  const delta = winrateVsBaseline(records, opts)
  const { recent } = splitTrailingWindow(records, opts.recentDays, opts.baselineDays)

  let sum = 0
  let read = 0
  for (const rec of recent) {
    const change = rec.data?.change_percent
    if (typeof change === 'number') {
      sum += change
      read++
    }
  }
  // The RANK side needs its own floor, not just the play side. Without one, a
  // single legible movement pill in a twenty-match window decided "deflation"
  // for the whole week — the play side was gated at MIN_SAMPLE while the
  // evidence it was being compared against could be a sample of one.
  //
  // Half the window, because that is the threshold at which the sum is about
  // the week rather than about whichever captures happened to OCR.
  const covered = recent.length > 0 && read / recent.length >= RANK_COVERAGE
  const netPercent = read > 0 && covered ? sum : null
  return { delta, netPercent, readCount: read, readOf: recent.length, verdict: judgeClimb(delta.sigma, netPercent) }
}

export interface ClimbVelocity {
  perSession: number | null
  perWeek: number | null
  sessions: number
  readCount: number
}

/**
 * Climb rate, denominated in the units the player actually experiences: a
 * session and a week, rather than a per-match average nobody feels.
 *
 * Both are null when nothing in the window reported a movement — the rate is
 * unknown, which is not the same as flat.
 */
export function climbVelocity(
  records: readonly MomentumInput[],
  opts: { days: number } = { days: 30 },
): ClimbVelocity {
  const { recent } = splitTrailingWindow(records, opts.days, 0)
  let sum = 0
  let read = 0
  for (const rec of recent) {
    const change = rec.data?.change_percent
    if (typeof change === 'number') {
      sum += change
      read++
    }
  }
  // BOTH denominators are derived from the window that produced the sum.
  // Passing a session count measured over the whole history divided a 30-day
  // movement by a year's worth of sessions and reported a climb rate several
  // times too small — a numerator and denominator describing different spans.
  const sessions = sessionCount(recent)
  if (read === 0) return { perSession: null, perWeek: null, sessions, readCount: 0 }
  const weeks = opts.days / 7
  return {
    perSession: sessions > 0 ? sum / sessions : null,
    perWeek: weeks > 0 ? sum / weeks : null,
    sessions,
    readCount: read,
  }
}

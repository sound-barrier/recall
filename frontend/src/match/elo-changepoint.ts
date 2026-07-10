// Change-point detection for the Elo tab: did the underlying win rate
// SHIFT at some moment, and what else changed around then? A single-break
// Bernoulli likelihood scan finds the best split; a seeded permutation
// test prices the "best over all splits" selection effect honestly; the
// context helper ties the dated break to what the app can see changing
// (review habit, hero pool). One deliberate confound stays in the fine
// print: climbing itself pulls the win rate toward 50%, which can read
// as a downward break.

import type { MatchRecord } from '@/api-client'
import { mulberry32 } from '@/match/elo-simulate'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { matchEpoch } from '@/match/match-trends-helpers'

export interface ChangePoint {
  index: number // first game of the new regime
  t: number // its epoch ms
  before: { winrate: number; n: number } // integer %
  after: { winrate: number; n: number }
  deltaPts: number // after − before, percentage points
  pValue: number // permutation p for the break being real
}

export interface ChangePointOpts {
  minSegment?: number
  permutations?: number
  seed?: number
}

// detectChangePoint scans every admissible split for the maximum-likelihood
// two-rate story and keeps it only when a permutation test says the
// improvement over the one-rate story is too big for luck (p < .05) AND the
// shift is worth acting on (≥ 5 points). Null otherwise.
export function detectChangePoint(
  timeline: readonly { t: number; win: boolean }[],
  opts: ChangePointOpts = {},
): ChangePoint | null {
  const minSegment = opts.minSegment ?? 15
  const permutations = opts.permutations ?? 500
  const n = timeline.length
  if (n < 2 * minSegment) return null

  const wins: number[] = timeline.map((x) => (x.win ? 1 : 0))
  const best = bestSplit(wins, minSegment)
  if (best === null) return null

  // Permutation test: shuffle the sequence (breaking any time structure),
  // re-scan, and count how often chance alone beats the observed G.
  const rng = mulberry32(opts.seed ?? 1)
  let exceed = 0
  const shuffled = [...wins]
  for (let p = 0; p < permutations; p++) {
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    const perm = bestSplit(shuffled, minSegment)
    if (perm !== null && perm.g >= best.g) exceed++
  }
  const pValue = (exceed + 1) / (permutations + 1)

  const beforeWins = best.prefixWins
  const beforeN = best.k
  const afterWins = best.totalWins - beforeWins
  const afterN = n - best.k
  const beforeRate = Math.round((beforeWins / beforeN) * 100)
  const afterRate = Math.round((afterWins / afterN) * 100)
  const deltaPts = afterRate - beforeRate
  if (pValue >= 0.05 || Math.abs(deltaPts) < 5) return null

  return {
    index: best.k,
    t: timeline[best.k]!.t,
    before: { winrate: beforeRate, n: beforeN },
    after: { winrate: afterRate, n: afterN },
    deltaPts,
    pValue,
  }
}

// bestSplit maximizes LL(two rates) via prefix sums; returns the split k,
// its G statistic vs the one-rate model, and the tallies the caller needs.
function bestSplit(
  wins: readonly number[],
  minSegment: number,
): { k: number; g: number; prefixWins: number; totalWins: number } | null {
  const n = wins.length
  const prefix = new Array<number>(n + 1)
  prefix[0] = 0
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i]! + wins[i]!
  const total = prefix[n]!
  const llTotal = bernoulliLL(total, n)

  let bestK = -1
  let bestLL = -Infinity
  for (let k = minSegment; k <= n - minSegment; k++) {
    const w1 = prefix[k]!
    const ll = bernoulliLL(w1, k) + bernoulliLL(total - w1, n - k)
    if (ll > bestLL) {
      bestLL = ll
      bestK = k
    }
  }
  if (bestK < 0) return null
  return { k: bestK, g: 2 * (bestLL - llTotal), prefixWins: prefix[bestK]!, totalWins: total }
}

// bernoulliLL is the maximized log-likelihood of w wins in n trials at
// the MLE rate w/n. All-win / all-loss segments contribute exactly 0.
function bernoulliLL(w: number, n: number): number {
  if (n === 0) return 0
  let ll = 0
  if (w > 0) ll += w * Math.log(w / n)
  if (w < n) ll += (n - w) * Math.log((n - w) / n)
  return ll
}

export interface ChangePointContext {
  reviewStarted: boolean // first-ever review lands within ±10 days of the break
  poolEntered: string[] // heroes in the pool only AFTER the break (top 2)
  poolLeft: string[] // …only BEFORE it (top 2)
}

// changePointContext looks for what the app can SEE changing around the
// break: the start of a review habit, and hero-pool membership shifts
// across the split. Correlation, not causation — the gloss says "around
// when", never "because".
export function changePointContext(
  records: readonly MatchRecord[],
  breakT: number,
  heroRole: (hero: string | null | undefined) => string,
): ChangePointContext {
  const DAY = 86_400_000
  const reviewTimes = records
    .map((r) => (r.reviewed_at ? new Date(r.reviewed_at).getTime() : null))
    .filter((t): t is number => t !== null && !Number.isNaN(t))
  const firstReview = reviewTimes.length > 0 ? Math.min(...reviewTimes) : null
  const reviewStarted = firstReview !== null && Math.abs(firstReview - breakT) <= 10 * DAY

  const before: MatchRecord[] = []
  const after: MatchRecord[] = []
  for (const r of records) {
    const t = matchEpoch(r)
    if (t === null) continue
    ;(t < breakT ? before : after).push(r)
  }
  const poolKeys = (recs: readonly MatchRecord[]) =>
    new Set(analyzeHeroPool(recs, DEFAULT_HERO_MEANINGFUL_PCT, heroRole).pool.map((h) => h.key))
  const poolBefore = poolKeys(before)
  const poolAfter = poolKeys(after)

  return {
    reviewStarted,
    poolEntered: [...poolAfter].filter((k) => !poolBefore.has(k)).slice(0, 2),
    poolLeft: [...poolBefore].filter((k) => !poolAfter.has(k)).slice(0, 2),
  }
}

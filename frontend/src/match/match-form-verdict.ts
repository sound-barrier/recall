import { LOW_SAMPLE_N } from '@/match/match-sample-helpers'
import type { SeasonMetrics } from '@/match/match-compare-helpers'

// The Form verdict: one word answering "am I playing better in window B than
// window A?", computed from the weighted rate movers between the two snapshots.
// Pure so the thresholds and mover-ranking are unit-testable; the view renders
// the word huge and the top movers as the subline.
//
// Honesty rules: every delta is quantized to its DISPLAY precision before it is
// scored, so a change that would render as "+0" can neither appear as a mover
// nor tip the verdict; and each axis carries its own sample floor — the
// decisive-games floor gates the word itself, while combat rates additionally
// require enough performance-bearing games on both sides (OCR coverage is
// partial, and a single game's rates must not headline a verdict).

type VerdictWord = 'SHARPER' | 'SLIPPING' | 'HOLDING' | 'TOO EARLY TO CALL'

interface VerdictMover {
  label: string // "Win rate +8 pts" — already display-formatted
  score: number // signed weighted contribution (positive = B better)
}

export interface FormVerdict {
  word: VerdictWord
  // Top movers by |contribution|, display-ready, only for judged verdicts.
  movers: string[]
}

// Weighted contributions, all normalized so "one clearly-felt improvement"
// lands near ±1: 10 win-rate points ≈ 1, one fewer death per 10 min ≈ 0.5,
// two more elims/assists per 10 ≈ 0.25, one division of rank ≈ 0.75.
const WINRATE_PER_POINT = 0.1
const DEATHS_PER_UNIT = 0.5
const ELIMS_PER_UNIT = 0.125
const ASSISTS_PER_UNIT = 0.125
const RANK_PER_DIVISION = 0.75

// |score| below this reads as noise → HOLDING.
const HOLDING_BAND = 0.35

function decisive(m: SeasonMetrics): number {
  return m.wins + m.losses
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

// moverIf quantizes both values to the metric's display precision FIRST, so the
// scored delta is exactly the difference the user can read — a sub-precision
// wiggle contributes nothing and never renders as a "+0" mover.
function moverIf(
  movers: VerdictMover[],
  a: number | null | undefined,
  b: number | null | undefined,
  weight: number,
  quantize: (n: number) => number,
  format: (delta: number) => string,
): void {
  if (a == null || b == null) return
  const delta = quantize(b) - quantize(a)
  if (delta === 0) return
  movers.push({ label: format(delta), score: delta * weight })
}

function signed(n: number, digits = 0): string {
  const mag = Math.abs(n).toFixed(digits)
  return `${n > 0 ? '+' : '−'}${mag}`
}

// Rank deltas are fractional divisions: show one decimal, trimmed ("+2", not
// "+2.0"), and pluralize off the displayed magnitude.
function rankLabel(delta: number): string {
  const mag = round1(Math.abs(delta))
  const magText = Number.isInteger(mag) ? String(mag) : mag.toFixed(1)
  return `Rank ${delta > 0 ? '+' : '−'}${magText} div${mag === 1 ? '' : 's'}`
}

// judgeForm compares window B against window A. Requires LOW_SAMPLE_N decisive
// games in BOTH windows — below that a single result swings the word, so the
// honest answer is "too early".
export function judgeForm(a: SeasonMetrics, b: SeasonMetrics): FormVerdict {
  if (decisive(a) < LOW_SAMPLE_N || decisive(b) < LOW_SAMPLE_N) {
    return { word: 'TOO EARLY TO CALL', movers: [] }
  }

  const movers: VerdictMover[] = []
  moverIf(movers, a.winratePct, b.winratePct, WINRATE_PER_POINT, Math.round,
    (d) => `Win rate ${signed(d)} pts`)

  // Combat rates need their own floor: averageKDA only covers games that carry
  // a performance block, which can be far fewer than the decisive count.
  const combatSolid = (a.combatSamples ?? 0) >= LOW_SAMPLE_N && (b.combatSamples ?? 0) >= LOW_SAMPLE_N
  if (combatSolid) {
    // Deaths are lower-better: falling deaths contribute positively.
    moverIf(movers, a.deathsPer10, b.deathsPer10, -DEATHS_PER_UNIT, round1,
      (d) => `Deaths ${signed(d, 1)}/10`)
    moverIf(movers, a.elimsPer10, b.elimsPer10, ELIMS_PER_UNIT, round1,
      (d) => `Elims ${signed(d, 1)}/10`)
    moverIf(movers, a.assistsPer10, b.assistsPer10, ASSISTS_PER_UNIT, round1,
      (d) => `Assists ${signed(d, 1)}/10`)
  }

  moverIf(movers, a.rankProgress, b.rankProgress, RANK_PER_DIVISION, round1, rankLabel)

  const score = movers.reduce((sum, m) => sum + m.score, 0)
  const word: VerdictWord =
    score > HOLDING_BAND ? 'SHARPER' :
    score < -HOLDING_BAND ? 'SLIPPING' :
    'HOLDING'

  const top = movers
    .slice()
    .sort((x, y) => Math.abs(y.score) - Math.abs(x.score))
    .slice(0, 3)
    .map((m) => m.label)
  return { word, movers: top }
}

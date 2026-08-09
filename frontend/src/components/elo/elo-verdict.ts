// The verdict card's brain, kept pure so every branch is unit-testable.
// One rule above all: every probability quoted here comes from the SAME
// decay-aware season simulator the rest of the page renders — the verdict
// is a summary of the simulation, never a second model that can disagree
// with the cards below it.

import { PROVISIONAL_MIN_DECISIVE } from '@/match/elo-model'
import type { CeilingRange } from '@/match/elo-bayes'
import { fmtGames, fmtScoreRank } from '@/components/elo/elo-format'

export interface VerdictSim {
  probReachTarget: number
  probEndLower: number
  gamesToTargetP50: number | null
  sims: number
}

export interface VerdictInput {
  target: string
  winRatePct: number
  n: number // REAL decisive games behind the rate
  isEdited: boolean
  alreadyThere: boolean
  requiredWinRate: number | null // decay's asymptotic hold-the-target rate
  expectedGamesDecay: number | null
  ceiling: CeilingRange
  sim: VerdictSim | null
  horizonGames: number
  paceAssumed: boolean
  weeksLabel: string | null
}

export interface Verdict {
  tone: '' | 'is-good' | 'is-hard' | 'is-early'
  eyebrow: string
  head: string
  sub: string
}

// fmtCeilingRange renders the ceiling's credible range for display —
// shared by the verdict and the results panel so the two never disagree.
export function fmtCeilingRange(c: CeilingRange): string {
  if (c.hi === null) return `${fmtScoreRank(c.lo)} or higher — no ceiling detectable yet`
  const lo = fmtScoreRank(c.lo)
  const hi = fmtScoreRank(c.hi)
  return lo === hi ? lo : `${lo}–${hi}`
}
const ceilingLabel = fmtCeilingRange

function reachClause(sim: VerdictSim | null, target: string, horizon: number, paceAssumed: boolean): string {
  if (sim === null) return ''
  const pct = Math.round(sim.probReachTarget * 100)
  const pace = paceAssumed ? ' (assuming ~10 games a week)' : ''
  return `Playing your record out ${sim.sims.toLocaleString()} times, ${pct}% of simulated seasons touch ${target} within ~${horizon} games${pace}.`
}

// deriveVerdict — the four-branch answer. Null only when the caller has
// nothing seeded (the empty state stays in the SFC).
export function deriveVerdict(v: VerdictInput): Verdict {
  if (v.alreadyThere) {
    return {
      tone: 'is-good',
      eyebrow: "You're there",
      head: `${v.target} reached`,
      sub: 'Your current rank is already at or above your target — aim higher to see a projection.',
    }
  }

  const forEdits = v.isEdited ? ' — for your edits' : ''
  const ceiling = ceilingLabel(v.ceiling)

  // Early read: too few decisive games to call a ceiling at all. Never
  // "Reality check", never "Capped" — one loss used to print both.
  if (v.n < PROVISIONAL_MIN_DECISIVE) {
    const games = `${v.n} decisive game${v.n === 1 ? '' : 's'}`
    const reach = v.sim === null ? 0 : Math.round(v.sim.probReachTarget * 100)
    return {
      tone: 'is-early',
      eyebrow: `Early read — only ${games}${forEdits}`,
      head: reach >= 50 ? `${v.target} looks reachable` : 'Too early to call',
      sub: `${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} ${games} barely pins a win rate, so read this as a sketch: your form most likely tops out somewhere between ${ceiling}, and that range tightens with every game. Around ${PROVISIONAL_MIN_DECISIVE} decisive games this becomes a real verdict.`.trim(),
    }
  }

  // Capped: at the dialed form, the decay plateau sits short of the target.
  if (v.requiredWinRate !== null) {
    const reqPct = v.requiredWinRate * 100
    const extra = Math.max(1, Math.round(reqPct - v.winRatePct))
    return {
      tone: 'is-hard',
      eyebrow: `Reality check${forEdits}`,
      head: `Capped near ${ceiling}`,
      sub: `At ${v.winRatePct}% over ${v.n} games, tougher opponents pull you level around ${ceiling} — short of ${v.target}. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} Holding ${v.target} would take about ${reqPct.toFixed(1)}% — roughly ${extra} more win${extra === 1 ? '' : 's'} per 100 games. That's improvement, not luck — and the playbook below is how you close the gap.`,
    }
  }

  // Reachable: the median simulated season is the headline number.
  const head = fmtGames(v.sim?.gamesToTargetP50 ?? v.expectedGamesDecay)
  const lowerPct = v.sim === null ? null : Math.round(v.sim.probEndLower * 100)
  const spread = lowerPct === null ? '' : ` ${lowerPct}% end lower than today — both numbers are ordinary spread at your rate, not the queue's mood.`
  const pace = v.weeksLabel === null ? '' : ` — ${v.weeksLabel}`
  return {
    tone: '',
    eyebrow: v.isEdited ? 'If your edits hold' : 'If your form holds',
    head,
    sub: `to reach ${v.target} in the median simulated season at ${v.winRatePct}%${pace}. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)}${spread} Your form points to a ceiling around ${ceiling}, past ${v.target} — the climb should stick; you're underranked, not hardstuck.`,
  }
}

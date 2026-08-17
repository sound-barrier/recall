// The verdict card's brain, kept pure so every branch is unit-testable.
// One rule above all: every probability quoted here comes from the SAME
// decay-aware season simulator the rest of the page renders — the verdict
// is a summary of the simulation, never a second model that can disagree
// with the cards below it.

import { PROVISIONAL_MIN_DECISIVE, gamesToWeeks } from '@/match/elo/elo-model'
import type { CeilingRange } from '@/match/elo/elo-bayes'
import { fmtGames, fmtScoreRank, fmtWeeks } from '@/components/elo/elo-format'

interface VerdictSim {
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
  // The target in ladder units, so the capped branch can tell a range that
  // falls short from one that straddles the target.
  targetScoreLadder: number
  sim: VerdictSim | null
  horizonGames: number
  paceAssumed: boolean
  // Weeks labels derive from the SAME games number as each headline —
  // pairing a sim/decay games count with the naive model's weeks made the
  // flagship sentence contradict its own arithmetic.
  gamesPerWeek: number | null
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
  if (c.hi === null) return `${fmtScoreRank(c.lo)} or higher — no hard ceiling is detectable yet`
  const lo = fmtScoreRank(c.lo)
  const hi = fmtScoreRank(c.hi)
  return lo === hi ? lo : `${lo}–${hi}`
}
const ceilingLabel = fmtCeilingRange

// weeksFor prices a games count at the player's pace — always the SAME
// games number the caller just put in the headline.
function weeksFor(games: number | null, gamesPerWeek: number | null): string {
  const label = fmtWeeks(gamesToWeeks(games, gamesPerWeek))
  return label ? ` — ${label}` : ''
}

function reachClause(sim: VerdictSim | null, target: string, horizon: number, paceAssumed: boolean): string {
  if (sim === null) return ''
  const pct = Math.round(sim.probReachTarget * 100)
  const pace = paceAssumed ? ' (assuming ~10 games a week)' : ''
  return `Playing your record out ${sim.sims.toLocaleString()} times, ${pct}% of simulated seasons touch ${target} within ~${horizon} games${pace}.`
}

function editSuffix(v: VerdictInput): string {
  return v.isEdited ? ' — for your edits' : ''
}

function alreadyThereVerdict(v: VerdictInput): Verdict {
  return {
    tone: 'is-good',
    eyebrow: "You're there",
    head: `${v.target} reached`,
    sub: 'Your current rank is already at or above your target — aim higher to see a projection.',
  }
}

// Early read: too few decisive games to call a ceiling at all. Never
// "Reality check", never "Capped" — one loss used to print both.
function earlyReadVerdict(v: VerdictInput): Verdict {
  const games = `${v.n} decisive game${v.n === 1 ? '' : 's'}`
  const reach = v.sim === null ? 0 : Math.round(v.sim.probReachTarget * 100)
  return {
    tone: 'is-early',
    eyebrow: `Early read — only ${games}${editSuffix(v)}`,
    head: reach >= 50 ? `${v.target} looks reachable` : 'Too early to call',
    sub: `${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} ${games} barely pins a win rate, so read this as a sketch: your form most likely tops out around ${ceilingLabel(v.ceiling)}, and that range tightens with every game. Around ${PROVISIONAL_MIN_DECISIVE} decisive games this becomes a real verdict.`.trim(),
  }
}

// Capped: at the dialed form, the decay plateau sits short of the target.
function cappedVerdict(v: VerdictInput): Verdict {
  const forEdits = editSuffix(v)
  const reqPct = v.requiredWinRate! * 100
  const extra = Math.max(1, Math.round(reqPct - v.winRatePct))
  const holdLine = `Holding ${v.target} would take about ${reqPct.toFixed(1)}% — roughly ${extra} more win${extra === 1 ? '' : 's'} per 100 games. That's improvement, not luck — and the playbook below is how you close the gap.`
  // When the measured slope's own CI admits an improver, asserting a cap
  // would contradict the range in the same sentence — soften to "short
  // of the target at today's form" and say the ceiling isn't pinned.
  if (v.ceiling.hi === null) {
    return {
      tone: 'is-hard',
      eyebrow: `Reality check${forEdits}`,
      head: `Short of ${v.target} at today's form`,
      sub: `At ${v.winRatePct}% over ${v.n} games, the measured decay says you'd level off before ${v.target} — but your climb history is still consistent with an improver, so no hard ceiling is detectable yet. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} ${holdLine}`,
    }
  }
  // The range's top clears the target: "capped short of it" would
  // contradict the range in the same breath. Borderline is the truth.
  if (v.ceiling.hi >= v.targetScoreLadder) {
    return {
      tone: 'is-hard',
      eyebrow: `Reality check${forEdits}`,
      head: `${v.target} is borderline`,
      sub: `At ${v.winRatePct}% over ${v.n} games, your ceiling range straddles ${v.target}: the measured middle lands short, the range's top clears it. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} ${holdLine}`,
    }
  }
  return {
    tone: 'is-hard',
    eyebrow: `Reality check${forEdits}`,
    head: `Capped near ${ceilingLabel(v.ceiling)}`,
    sub: `At ${v.winRatePct}% over ${v.n} games, tougher opponents pull you level around ${ceilingLabel(v.ceiling)} — short of ${v.target}. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)} ${holdLine}`,
  }
}

function spreadClause(sim: VerdictSim | null): string {
  const lowerPct = sim === null ? null : Math.round(sim.probEndLower * 100)
  return lowerPct === null ? '' : ` ${lowerPct}% end lower than today — ordinary spread at your rate, not the queue's mood.`
}

// Open-top label doesn't compose mid-sentence — give it its own tail.
function ceilingTail(v: VerdictInput): string {
  return v.ceiling.hi === null
    ? ` Your climb history shows no hard ceiling yet — the climb should stick; you're underranked, not hardstuck.`
    : ` Your form points to a ceiling around ${ceilingLabel(v.ceiling)}, past ${v.target} — the climb should stick; you're underranked, not hardstuck.`
}

// The median simulated season doesn't arrive within the horizon (reach
// < 50% swallows the p50): the decay expectation leads and the copy
// says exactly that instead of claiming a median that never happened.
function decayPaceVerdict(v: VerdictInput): Verdict {
  const reach = v.sim === null ? null : Math.round(v.sim.probReachTarget * 100)
  const seasonNote = reach === null
    ? ''
    : ` Only ${reach}% of simulated seasons get there within ~${v.horizonGames} games — most need longer than one season.`
  return {
    tone: '',
    eyebrow: v.isEdited ? 'If your edits hold' : 'If your form holds',
    head: fmtGames(v.expectedGamesDecay),
    sub: `to reach ${v.target} at ${v.winRatePct}% if the tougher-lobbies pace holds${weeksFor(v.expectedGamesDecay, v.gamesPerWeek)}.${seasonNote}${spreadClause(v.sim)}${ceilingTail(v)}`,
  }
}

// Reachable: the median simulated season is the headline when it exists.
function reachableVerdict(v: VerdictInput): Verdict {
  const p50 = v.sim?.gamesToTargetP50 ?? null
  if (p50 === null) return decayPaceVerdict(v)
  return {
    tone: '',
    eyebrow: v.isEdited ? 'If your edits hold' : 'If your form holds',
    head: fmtGames(p50),
    sub: `to reach ${v.target} in the median simulated season at ${v.winRatePct}%${weeksFor(p50, v.gamesPerWeek)}. ${reachClause(v.sim, v.target, v.horizonGames, v.paceAssumed)}${spreadClause(v.sim)}${ceilingTail(v)}`,
  }
}

// deriveVerdict — the four-branch answer. Null only when the caller has
// nothing seeded (the empty state stays in the SFC).
export function deriveVerdict(v: VerdictInput): Verdict {
  if (v.alreadyThere) return alreadyThereVerdict(v)
  if (v.n < PROVISIONAL_MIN_DECISIVE) return earlyReadVerdict(v)
  if (v.requiredWinRate !== null) return cappedVerdict(v)
  return reachableVerdict(v)
}

import { fmtPct, fmtProb, fmtPValue } from '@/components/elo/elo-format'

// Pure card builders behind EloMythChecks.vue — "Is it really Elo
// Hell?" answered against the player's own games. Each builder returns
// its Check or null when its stat is unavailable; buildChecks keeps the
// fixed card order. The SFC feeds unwrapped useEloCalc values through
// MythCheckInputs and renders the result verbatim (the elo-scenarios
// snapshot suite pins every string — copy changes are deliberate acts).

export interface Check {
  id: string
  stat: string
  q: string
  a: string
  note: string
  tone: string
}

// The slice of useEloCalc (plus the SFC's pre-formatted rank strings)
// the card builders actually read — permissive shapes so callers and
// tests aren't forced to satisfy fields the builders never touch.
export interface MythCheckInputs {
  projInput: { targetScore: number; currentScore: number } | null
  pValue: number | null
  sampleN: number
  effectiveWinRatePct: number | null
  trueRateRange: { lower: number; upper: number } | null
  skepticVerdict: number | null
  provisional: boolean
  lossStreak: number | null
  streakLen: number
  streakHorizon: number
  runs: { pValue: number; z: number; nWins: number; nLosses: number; runs: number; expectedRuns: number } | null
  probThisSeason: number | null
  seasonGames: number | null
  requiredWrForSeason: number | null
  decay: { requiredWinRate: number | null } | null
  seasonSim: { sims: number } | null
  simHorizonGames: number
  paceAssumed: boolean
  rankNow: string
  target: string
  // The player's OWN standing and how it moved. Structural shape, matching this
  // file's rule that callers are not forced to satisfy fields the builders
  // never touch.
  percentileTrail: {
    now: number
    nowRank: string | null
    previous: number | null
    deltaPts: number | null
    comparableN: number
    n: number
  } | null
}

export function buildChecks(i: MythCheckInputs): Check[] {
  if (!i.projInput) return []
  const cards = [
    riggedCheck(i),
    skepticCheck(i),
    streakCheck(i),
    runsCheck(i),
    standingCheck(i),
    seasonCheck(i),
  ]
  return cards.filter((c): c is Check => c !== null)
}

// "Where do I stand?" — the successor to the population card deleted in
// a928122f, and deliberately a different card.
//
// The old one answered with a share read out of a published distribution, and
// season 4's Rank Redistribution voided that distribution: it moved Platinum
// and Diamond players into a tier that had not existed, so every share it
// printed became wrong. Nothing replaced the distribution, so this card does not
// try. It reports what the player's own screenshots said — where they stand, and
// where they stood before — which needs no population model at all.
//
// It also never says "hardstuck". That was a DIAGNOSIS layered on the number,
// and a diagnosis needs a comparison this card cannot make.
function standingCheck(i: MythCheckInputs): Check | null {
  const p = i.percentileTrail
  if (p === null) return null
  // The rank the reading was PRINTED AGAINST, not the calculator's current one.
  // A percentile is a statement about a specific rank, and the latest capture
  // carrying a caption can be older than the latest rank reading.
  const at = p.nowRank ?? i.rankNow

  // Unpaired has two distinct causes and they are not interchangeable. One
  // reading is simply early. Several readings that refuse to pair means every
  // earlier one sits in a previous season, which is a different sentence — and
  // claiming "one reading so far" there would be false.
  if (p.deltaPts === null || p.previous === null) {
    return {
      id: 'standing', stat: 'percentile', q: 'Where do I stand?',
      a: `Above ${fmtPct(p.now)} of players`,
      note: p.n <= 1
        ? `Read off your rank screen at ${at}. One reading so far, so there is nothing to compare it against yet — a second post-placement rank screenshot this season gives you the movement.`
        : `Read off your rank screen at ${at}. ${p.n} readings so far, but the earlier ones fall in previous seasons — a rank redistribution moves the whole population, so comparing across one would measure two different ladders.`,
      tone: 'neutral',
    }
  }
  return {
    id: 'standing', stat: 'percentile', q: 'Where do I stand?',
    a: `Above ${fmtPct(p.now)} of players`,
    note: `${movedPhrase(p.deltaPts)} from ${fmtPct(p.previous)} earlier this season, across ${p.comparableN} readings at ${at}. Both numbers come off your own rank screens; only same-season readings are compared, because a rank redistribution moves the whole population and would make the difference meaningless.`,
    tone: movementTone(p.deltaPts),
  }
}

// A movement of exactly 0 is "unchanged", not a climb and not a slide — the
// player held their ground, which is a real answer to the question.
// "pts", not "%": the gap between two percentiles is a difference in
// percentage POINTS, and printing it with a % sign invites reading it as a
// relative change. Matches the Compare tab's convention.
function movedPhrase(deltaPts: number): string {
  if (deltaPts > 0) return `up ${deltaPts} pts`
  if (deltaPts < 0) return `down ${Math.abs(deltaPts)} pts`
  return 'unchanged'
}

function movementTone(deltaPts: number): string {
  if (deltaPts > 0) return 'good'
  if (deltaPts < 0) return 'bad'
  return 'neutral'
}

// A credible interval pinned this tight (± points on the true rate) means
// the sample has ANSWERED the rigged question — "not significant" at that
// volume is a verdict of "near even", never "too few games".
const PINNED_HALF_WIDTH_PTS = 5

const RIGGED_HEAD = { id: 'rigged', stat: 'p-value', q: 'Rigged MMR?' }

// riggedCheck answers the rigged-MMR complaint in four honest registers:
// the rate is clearly real (significant — celebratory only when it's GOOD
// news); the rate is measured well and genuinely near even (a slow climb
// or grind looks like this); measured well but leaning one way, just shy
// of proof; or there honestly aren't enough games yet to say.
function riggedCheck(i: MythCheckInputs): Check | null {
  const p = i.pValue
  if (p === null) return null
  if (p < 0.05) return riggedSignificant(i, p)
  return riggedPinned(i, p) ?? riggedTooFew(i, p)
}

function riggedSignificant(i: MythCheckInputs, p: number): Check {
  const rate = i.effectiveWinRatePct
  const above = rate !== null && rate > 50
  return {
    ...RIGGED_HEAD,
    a: 'No — that rate is real',
    note: `Over ${i.sampleN} game${i.sampleN === 1 ? '' : 's'}, luck alone almost never lands on ${String(rate)}%.${above ? '' : " It's really yours — which means the playbook above can really move it."} (${fmtPValue(p)})`,
    tone: above ? 'good' : 'neutral',
  }
}

interface PinnedRate {
  p: number
  rate: number
  lo: number
  hi: number
}

function riggedPinned(i: MythCheckInputs, p: number): Check | null {
  const iv = i.trueRateRange
  const rate = i.effectiveWinRatePct
  const halfPts = iv === null ? null : ((iv.upper - iv.lower) / 2) * 100
  if (iv === null || halfPts === null || halfPts > PINNED_HALF_WIDTH_PTS || rate === null) return null
  const pinned = { p, rate, lo: Math.round(iv.lower * 100), hi: Math.round(iv.upper * 100) }
  if (Math.abs(rate - 50) <= 2.5) return riggedNearEven(i, pinned)
  return riggedLeaning(i, pinned)
}

function riggedNearEven(i: MythCheckInputs, pinned: PinnedRate): Check {
  const lean = shadeOfEven(pinned.rate)
  const closing = pinned.rate >= 50
    ? 'A slow climb looks exactly like this.'
    : 'A slow grind looks exactly like this — the playbook above is where the shade flips.'
  return {
    ...RIGGED_HEAD,
    a: 'No — near even, measured well',
    note: `${i.sampleN} games pin your true win rate to ${pinned.lo}–${pinned.hi}% — ${lean}, far too close to even for a rigged matchmaker to be hiding in it. ${closing} (${fmtPValue(pinned.p)})`,
    tone: 'good',
  }
}

function riggedLeaning(i: MythCheckInputs, pinned: PinnedRate): Check {
  const below = pinned.rate < 50
  return {
    ...RIGGED_HEAD,
    a: below ? 'No — a real dip, not a rigging' : 'No — a real edge, shy of proof',
    note: `${i.sampleN} games put your true win rate around ${pinned.lo}–${pinned.hi}% — ${below
      ? "leaning below even. That's not a rigged queue, it's a fixable rate: the playbook above is the way back."
      : 'leaning above even; a little more volume makes it undeniable.'} (${fmtPValue(pinned.p)})`,
    tone: below ? 'warn' : 'neutral',
  }
}

function riggedTooFew(i: MythCheckInputs, p: number): Check {
  return {
    ...RIGGED_HEAD,
    a: 'Too few games to tell',
    note: `At ${i.sampleN} game${i.sampleN === 1 ? '' : 's'} your record still looks like a coin flip — play more before blaming the system. (${fmtPValue(p)})`,
    tone: 'neutral',
  }
}

function shadeOfEven(rate: number): string {
  if (rate > 50) return 'a shade above even'
  if (rate < 50) return 'a shade below even'
  return 'dead even'
}

// coinAnswer keeps the headline in plain odds language across the range.
function coinAnswer(prob: number): string {
  if (prob >= 99) return 'Almost certainly'
  if (prob >= 90) return 'Very likely'
  if (prob >= 60) return `Probably — ${prob} in 100`
  if (prob > 40) return 'Genuinely even odds'
  if (prob > 10) return 'Probably not'
  return 'Almost certainly not'
}

function skepticLean(prob: number): string {
  if (prob >= 60) return `with more of it above even than below (${prob} to ${100 - prob}). A slow climb lives exactly in this zone`
  if (prob <= 40) return `with more of it below even than above (${100 - prob} to ${prob}) — the playbook above is the way out`
  return 'balanced almost evenly around 50 — dead even is a real place to be, and the playbook is how you leave it'
}

function skepticTone(prob: number): string {
  if (prob >= 90) return 'good'
  if (prob <= 50) return 'warn'
  return 'neutral'
}

// The Bayesian counterpart of the p-value: start by assuming the player
// is a pure coin flip and let the games move the odds. One probability,
// plus the credible range — CONNECTED, so a range that straddles 50
// reads as "more of it above even than below", not as a contradiction.
function skepticCheck(i: MythCheckInputs): Check | null {
  if (i.skepticVerdict === null || i.trueRateRange === null) return null
  const prob = Math.round(i.skepticVerdict * 100)
  const lo = Math.round(i.trueRateRange.lower * 100)
  const hi = Math.round(i.trueRateRange.upper * 100)
  const lean = skepticLean(prob)
  // Below the verdict floor this number is mostly the prior — say so,
  // and never color it as a finding.
  const priorNote = i.provisional
    ? ` At ${i.sampleN} games this is still mostly the skeptic prior talking — it starts you at 50-50 with ~20 pseudo-games of stubbornness. Play on before reading much into it.`
    : ''
  return {
    id: 'skeptic', stat: 'bayes', q: 'Better than a coin?',
    a: coinAnswer(prob),
    note: `Start from the harshest assumption — that you're a pure coin flip. Your ${i.sampleN} game${i.sampleN === 1 ? '' : 's'} move the odds to ${prob} in 100 that your true win rate beats even. The rate itself most likely sits in ${lo}–${hi}%, ${lean}.${priorNote}`,
    tone: i.provisional ? 'neutral' : skepticTone(prob),
  }
}

// Below half a percent, "rare, but real" oversells a rounding artifact.
function lossStreakCopy(i: MythCheckInputs, chance: number): { a: string; note: string } {
  if (chance >= 0.2) {
    return {
      a: `${fmtPct(chance * 100)} — normal`,
      note: `A ${i.streakLen}-loss streak in your next ${i.streakHorizon} games is ${fmtPct(chance * 100)} likely at ${String(i.effectiveWinRatePct)}%. Expected, not rigged.`,
    }
  }
  if (chance >= 0.005) {
    return {
      a: `${fmtPct(chance * 100)} — rare, but real`,
      note: `Even at ${String(i.effectiveWinRatePct)}%, a ${i.streakLen}-loss run lands about ${fmtPct(chance * 100)} of the time over ${i.streakHorizon} games — rare enough to sting, still just variance.`,
    }
  }
  return {
    a: 'Effectively never at this rate',
    note: `At ${String(i.effectiveWinRatePct)}%, a ${i.streakLen}-loss run over ${i.streakHorizon} games rounds to zero — if one happens anyway, look at tilt before the matchmaker.`,
  }
}

function streakCheck(i: MythCheckInputs): Check | null {
  if (i.lossStreak === null) return null
  const { a, note } = lossStreakCopy(i, i.lossStreak)
  return { id: 'streaks', stat: 'streak', q: 'Endless loss streaks?', a, note, tone: 'neutral' }
}

function runsAnswer(coinLike: boolean, z: number): string {
  if (coinLike) return 'Coin-like — nothing scripted'
  return z < 0 ? 'Streakier than chance' : 'More alternating than chance'
}

function runsReading(coinLike: boolean, z: number): string {
  if (coinLike) return 'Your streaks are exactly what honest randomness produces.'
  if (z < 0) return 'Real clustering usually means tilt carrying over, not a script — see the streak rows below.'
  return 'Slightly more regular than random — nothing sinister about that either.'
}

// Wald–Wolfowitz on the ACTUAL played sequence: do results cluster more
// than an honest coin at this rate would? The direct "scripted streaks"
// answer — and when clustering IS real, tilt is the mundane culprit.
function runsCheck(i: MythCheckInputs): Check | null {
  if (i.runs === null) return null
  const r = i.runs
  const coinLike = r.pValue >= 0.05
  return {
    id: 'scripted', stat: 'runs', q: 'Scripted streaks?',
    a: runsAnswer(coinLike, r.z),
    note: `Your ${r.nWins + r.nLosses} games form ${r.runs} win/loss runs; a fair sequence at your rate averages ${Math.round(r.expectedRuns)} (${fmtPValue(r.pValue)}). ${runsReading(coinLike, r.z)}`,
    tone: coinLike ? 'good' : 'neutral',
  }
}

// One model: this IS the simulator's reach share — the same number the
// season band shows, decay included, so this card can never contradict
// the verdict again. (The old copy quoted a no-decay closed form here
// while the verdict used the decay plateau; the "80% next to Capped"
// confusion was born on this card.)
function seasonSimCheck(i: MythCheckInputs, sims: number): Check {
  const rate = i.effectiveWinRatePct
  const req = i.decay?.requiredWinRate
  const hold = req !== null && req !== undefined
    ? ` Holding ${i.target} once you touch it would take about ${(req * 100).toFixed(1)}% — the playbook's job, not the queue's.`
    : ''
  const pace = i.paceAssumed ? ', assuming ~10 games a week' : ' at your pace'
  return {
    id: 'season', stat: 'season', q: 'This season?',
    a: fmtProb(i.probThisSeason),
    note: `Playing your ${String(rate)}% record out ${sims.toLocaleString()} times — lobbies toughening as you climb, like the amber curve — these are your odds of touching ${i.target} within ~${i.simHorizonGames} games${pace}. Touching counts any moment of the season; you can brush it and still slip back.${hold}`,
    tone: 'neutral',
  }
}

function seasonCappedCheck(i: MythCheckInputs): Check {
  const rate = i.effectiveWinRatePct
  const req = i.requiredWrForSeason
  return {
    id: 'season', stat: 'season', q: 'This season?',
    a: 'Not at this rate',
    note: `At ${String(rate)}% the climb to ${i.target} never completes — you'd need about ${req !== null ? `${(req * 100).toFixed(1)}%` : 'more than this season allows'} to get there within ~${String(i.seasonGames)} games. That number is the playbook's job, not the queue's.`,
    tone: 'neutral',
  }
}

function seasonCheck(i: MythCheckInputs): Check | null {
  if (i.projInput !== null && i.probThisSeason !== null && i.seasonSim !== null) {
    return seasonSimCheck(i, i.seasonSim.sims)
  }
  if (i.seasonGames !== null && i.projInput !== null && i.projInput.targetScore > i.projInput.currentScore) {
    return seasonCappedCheck(i)
  }
  return null
}

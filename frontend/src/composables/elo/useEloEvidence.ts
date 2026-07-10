import { computed, type ComputedRef, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier.types'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { leaverRate, winrateBySessionIndex } from '@/match/match-momentum-helpers'
import { afterResultCounts, streakMeterImpact, winrateByStreakDepth } from '@/match/elo-streaks'
import { expectedMeterDelta, meterMoveSamples } from '@/match/elo-simulate'
import { normalCdf } from '@/match/elo-stats'
import { twoByTwoChiSquareP } from '@/match/elo-stats'
import { LOW_SAMPLE_N } from '@/match/match-sample-helpers'

// "What actually moves your rank" — the levers a player controls, each an item
// pairing one measured number with a plain-language gloss. The myth-busting
// stats (rigged MMR, streaks, percentile) live in EloMythChecks; this is the
// constructive half. Items whose sample is empty hide (never show zeros as
// insight).

export interface EvidenceItem {
  id: string
  label: string
  value: string
  gloss: string
  tone: 'good' | 'warn' | 'neutral'
  lowSample?: boolean
}

export interface EloEvidenceOpts {
  trackRecs: ComputedRef<MatchRecord[]>
  leaverHandling: Readonly<Ref<LeaverHandling>>
  heroRole: (hero: string | null | undefined) => string
}

export function useEloEvidence(opts: EloEvidenceOpts) {
  const dossier = useMatchesDossier(opts.trackRecs, opts.leaverHandling, opts.heroRole)

  const items = computed<EvidenceItem[]>(() => {
    const out: (EvidenceItem | null)[] = [
      reviewHabit(dossier.reviewedCount.value, dossier.daysSinceLastReview.value.days, coachCount(opts.trackRecs.value)),
      sinceReview(dossier.wldSinceLastReview.value),
      poolDiscipline(opts.trackRecs.value, opts.heroRole),
      streakTilt(opts.trackRecs.value),
      streakMeter(opts.trackRecs.value),
      sessionHygiene(opts.trackRecs.value),
      leavers(opts.trackRecs.value),
    ]
    return out.filter((i): i is EvidenceItem => i !== null)
  })

  return { items }
}

function pct(v: number): string {
  return `${Math.round(v)}%`
}

function reviewHabit(
  counts: { reviewed: number; total: number; percent: number },
  daysSince: number | null,
  coach: number,
): EvidenceItem | null {
  if (counts.total === 0) return null
  const recency = daysSince === null ? 'never reviewed' : `last one ${daysSince} day${daysSince === 1 ? '' : 's'} ago`
  const coaching = coach > 0 ? ` ${coach} with a coach.` : ' None with a coach.'
  return {
    id: 'reviews',
    label: 'Reviewing your games',
    value: `${counts.reviewed} of ${counts.total}`,
    gloss: `You've reviewed ${pct(counts.percent)} of these games (${recency}).${coaching} Reviewing is the single biggest lever you control.`,
    tone: counts.percent >= 10 ? 'good' : 'warn',
  }
}

function sinceReview(wld: { w: number; l: number; d: number } | null): EvidenceItem | null {
  if (wld === null || wld.w + wld.l === 0) return null
  return {
    id: 'since-review',
    label: 'Since your last review',
    value: `${wld.w}W–${wld.l}L`,
    gloss: `Your record since the last game you reviewed is ${wld.w}W–${wld.l}L.`,
    tone: 'neutral',
  }
}

function poolDiscipline(
  recs: readonly Pick<MatchRecord, 'data'>[],
  heroRole: (hero: string | null | undefined) => string,
): EvidenceItem | null {
  const split = analyzeHeroPool(recs, DEFAULT_HERO_MEANINGFUL_PCT, heroRole).split
  if (split.pure.decisive === 0 || split.out.decisive === 0) return null
  const cost = split.pure.winrate - split.out.winrate
  return {
    id: 'pool',
    label: 'Sticking to your best heroes',
    value: `${split.pure.winrate}% on · ${split.out.winrate}% off`,
    gloss: `You win ${split.pure.winrate}% on your main heroes vs ${split.out.winrate}% off them (${split.pure.decisive} vs ${split.out.decisive} games)${cost > 0 ? ' — off-pool games are spending rank on practice.' : '.'}`,
    tone: cost > 5 ? 'warn' : 'neutral',
    lowSample: split.out.decisive < LOW_SAMPLE_N,
  }
}

// streakTilt extends the one-game tilt readout to the whole run: the
// next-game win rate as a loss streak deepens (1 / 2 / 3+ back), with the
// after-a-loss vs after-a-win 2×2 tested for significance. The deeper the
// sag, the earlier stepping away starts paying — and streak games also
// swing the meter hardest (see streakMeter), so the rank cost compounds.
function streakTilt(recs: readonly MatchRecord[]): EvidenceItem | null {
  const depth = winrateByStreakDepth(recs)
  const first = depth.afterLoss[0]
  if (!first || first.sample < LOW_SAMPLE_N || first.winrate === null) return null

  const shown = depth.afterLoss.filter((d) => d.sample >= LOW_SAMPLE_N && d.winrate !== null)
  const value = `${shown.map((d) => `${d.winrate}%`).join(' · ')} as losses stack`
  const ladder = shown
    .map((d) => `${d.winrate}% after ${depthWord(d.depth, shown.length)}`)
    .join(', ')

  const counts = afterResultCounts(recs)
  const p = twoByTwoChiSquareP(counts.winAfterWin, counts.lossAfterWin, counts.winAfterLoss, counts.lossAfterLoss)
  const pClause = p === null
    ? ''
    : p < 0.05
      ? ` The after-a-loss dip is a real pattern (${fmtP(p)}), not queue punishment.`
      : ` The after-a-loss dip is within noise so far (${fmtP(p)}).`

  const deepest = shown[shown.length - 1]
  const sagging = deepest !== undefined && deepest.winrate !== null
    && depth.baselineWinrate !== null && deepest.winrate < depth.baselineWinrate - 5
  return {
    id: 'streak-tilt',
    label: 'Deeper into a loss streak',
    value,
    gloss: `Your next-game win rate: ${ladder} (baseline ${depth.baselineWinrate}% over ${depth.baselineSample} games).${pClause}${sagging ? ' Two down is the cheapest moment to stop — every further game has more rank to give.' : ' Your play holds up inside streaks — if you cut a bad night short, do it for the meter math, not your form.'}`,
    tone: sagging ? 'warn' : 'good',
  }
}

function depthWord(depth: number, bucketCount: number): string {
  if (depth === 1) return 'one loss'
  if (depth === 2) return 'two straight'
  return bucketCount >= 3 ? `${depth} or more` : `${depth} straight`
}

// streakMeter is the mechanical half of the user's observation that
// streaks decide their rank: the rank card's own streak modifiers move
// the meter more per game, in both directions.
function streakMeter(recs: readonly MatchRecord[]): EvidenceItem | null {
  const m = streakMeterImpact(recs)
  if (m === null) return null
  const ratio = Math.round(m.ratio * 10) / 10
  const divisions = (netPct: number) => (Math.abs(netPct) / 100).toFixed(1)
  return {
    id: 'streak-meter',
    label: 'Streaks move your meter more',
    value: `${ratio}× inside streaks`,
    gloss: `Your rank cards move ±${Math.round(m.streakAbsMean)}% during a streak vs ±${Math.round(m.normalAbsMean)}% otherwise (${m.streakN} streak games measured). Win-streak games have banked +${Math.round(m.winStreakNet)}% meter (≈${divisions(m.winStreakNet)} divisions); loss-streak games gave back ${Math.round(m.lossStreakNet)}% (≈${divisions(m.lossStreakNet)} divisions). Ride the former; cut the latter early — each extra game in a losing run has more ground to give.`,
    tone: Math.abs(m.lossStreakNet) > m.winStreakNet ? 'warn' : 'neutral',
  }
}

// sessionHygiene is the "when in a session do I start losing?" ladder:
// win rate by game-number-in-session (1 / 2 / 3 / 4+), a significance
// clause from the logistic trend, and — when the rank-card pools allow —
// the advice priced in meter. The quit-timing caveat stays attached:
// people stop playing differently after wins vs losses, which bends this
// curve, so trust the direction more than the decimals.
function sessionHygiene(recs: readonly MatchRecord[]): EvidenceItem | null {
  const b = winrateBySessionIndex(recs)
  const first = b.buckets[0]
  const last = b.buckets[b.buckets.length - 1]
  if (!first || !last) return null
  if (first.sample < LOW_SAMPLE_N || last.sample < LOW_SAMPLE_N) return null
  const shown = b.buckets.filter((x) => x.sample >= LOW_SAMPLE_N && x.winrate !== null)
  if (shown.length < 2) return null

  const totalWins = b.buckets.reduce((s2, x) => s2 + x.wins, 0)
  const totalN = b.buckets.reduce((s2, x) => s2 + x.sample, 0)
  const baseline = Math.round((totalWins / totalN) * 100)

  let pClause = ''
  let significant = false
  if (b.slope !== null && b.slope.se > 0) {
    const p = Math.min(1, 2 * (1 - normalCdf(Math.abs(b.slope.slope / b.slope.se))))
    significant = p < 0.05 && b.slope.slope < 0
    pClause = significant
      ? ` The late-session sag is a real pattern (${fmtP(p)}).`
      : ` The by-game trend is within noise so far (${fmtP(p)}).`
  }

  let priced = ''
  const lastRate = (last.winrate ?? 0) / 100
  const samples = meterMoveSamples(recs)
  const atBase = expectedMeterDelta(samples, totalWins / totalN)
  const atLate = expectedMeterDelta(samples, lastRate)
  if (atBase !== null && atLate !== null && atBase - atLate >= 0.5) {
    priced = ` Each game that deep costs ≈${(atBase - atLate).toFixed(1)}% meter vs your typical game — stopping one earlier is nearly free rank.`
  }

  const ladder = shown
    .map((x) => `${x.winrate}% at game ${x.index === b.buckets.length ? `${x.index}+` : x.index}`)
    .join(', ')
  const sagging = last.winrate !== null && last.winrate < baseline - 5 && significant
  return {
    id: 'session-hygiene',
    label: 'Deeper into a session',
    value: `${shown.map((x) => `${x.winrate}%`).join(' · ')} by game in session`,
    gloss: `Across ${b.sessions} sessions: ${ladder} (baseline ${baseline}%).${pClause}${priced} Quit-timing habits bend this curve — trust the direction, not the decimals.`,
    tone: sagging ? 'warn' : 'good',
  }
}

function fmtP(p: number): string {
  if (p < 0.0001) return 'p < 0.0001'
  return `p = ${p.toFixed(p < 0.01 ? 3 : 2)}`
}

function leavers(recs: readonly MatchRecord[]): EvidenceItem | null {
  const lr = leaverRate(recs)
  if (lr.rate === null || lr.leaverCount === 0) return null
  return {
    id: 'leavers',
    label: 'Leavers',
    value: pct(lr.rate),
    gloss: `${pct(lr.rate)} of these games had a leaver — bad luck that hits both teams equally and is already baked into your win rate.`,
    tone: 'neutral',
  }
}

function coachCount(recs: readonly MatchRecord[]): number {
  return recs.filter((r) => r.reviewed_by === 'coach').length
}

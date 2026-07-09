import { computed, type ComputedRef, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier.types'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { leaverRate } from '@/match/match-momentum-helpers'
import { afterResultCounts, streakMeterImpact, winrateByStreakDepth } from '@/match/elo-streaks'
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
    gloss: `Your next-game win rate: ${ladder} (baseline ${depth.baselineWinrate}% over ${depth.baselineSample} games).${pClause}${sagging ? ' Two down is the cheapest moment to stop — every further game has more rank to give.' : ' Your play holds up inside streaks — the meter risk below is the only reason to pace yourself.'}`,
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

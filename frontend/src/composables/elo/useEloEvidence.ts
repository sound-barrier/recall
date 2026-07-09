import { computed, type ComputedRef, type Ref } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useMatchesDossier } from '@/composables/matches/useMatchesDossier'
import type { LeaverHandling } from '@/composables/matches/useMatchesDossier.types'
import { analyzeHeroPool, DEFAULT_HERO_MEANINGFUL_PCT } from '@/match/match-hero-pool-helpers'
import { winrateAfterResult, leaverRate } from '@/match/match-momentum-helpers'
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
      tiltDelta(opts.trackRecs.value),
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

function tiltDelta(recs: readonly MatchRecord[]): EvidenceItem | null {
  const afterLoss = winrateAfterResult(recs, 'defeat')
  const afterWin = winrateAfterResult(recs, 'victory')
  if (afterLoss.sample < LOW_SAMPLE_N || afterWin.sample < LOW_SAMPLE_N) return null
  if (afterLoss.winrate === null || afterWin.winrate === null) return null
  const drop = afterWin.winrate - afterLoss.winrate
  return {
    id: 'tilt',
    label: 'Playing on tilt',
    value: `${afterLoss.winrate}% after a loss`,
    gloss: drop > 5
      ? `You win ${afterLoss.winrate}% right after a loss vs ${afterWin.winrate}% after a win — the queue isn't punishing you; your play slips. Take the break.`
      : `Your win rate barely changes after a loss (${afterLoss.winrate}% vs ${afterWin.winrate}% after a win) — tilt isn't costing you rank.`,
    tone: drop > 5 ? 'warn' : 'good',
  }
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

<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtPct, fmtProb, fmtPValue, fmtRank } from '@/components/elo/elo-format'

// "Is it really Elo Hell?" — the loudest complaints (rigged MMR, scripted
// streaks, endless loss runs, hardstuck) answered against the player's own
// games, plus the season-odds. Each stat leads with a plain sentence; the raw
// figure sits in a muted aside for anyone who wants it.
const {
  projInput, pValue, sampleN, winRatePct, lossStreak, streakLen, streakHorizon,
  percentileNow, percentileTarget, probThisSeason, seasonGames,
  targetTier, targetDivision, currentTier, currentDivision,
  skepticVerdict, trueRateRange, runs,
} = useEloCalc()

const rankNow = computed(() => fmtRank(currentTier.value, currentDivision.value))
const target = computed(() => fmtRank(targetTier.value, targetDivision.value))

interface Check { id: string; stat: string; q: string; a: string; note: string; tone: string }

// A credible interval pinned this tight (± points on the true rate) means
// the sample has ANSWERED the rigged question — "not significant" at that
// volume is a verdict of "near even", never "too few games".
const PINNED_HALF_WIDTH_PTS = 5

// riggedCheck answers the rigged-MMR complaint in three honest registers:
// the rate is clearly not a coin (significant); the rate is measured well
// and simply near even (high volume — a slow climb looks like this); or
// there genuinely aren't enough games yet to say either.
function riggedCheck(): Check {
  const p = pValue.value!
  if (p < 0.05) {
    return {
      id: 'rigged', stat: 'p-value', q: 'Rigged MMR?',
      a: 'No — that rate is real',
      note: `Over ${sampleN.value} games, luck alone almost never lands on ${winRatePct.value}%. (${fmtPValue(p)})`,
      tone: 'good',
    }
  }
  const iv = trueRateRange.value
  const halfPts = iv === null ? null : ((iv.upper - iv.lower) / 2) * 100
  if (iv !== null && halfPts !== null && halfPts <= PINNED_HALF_WIDTH_PTS) {
    const lo = Math.round(iv.lower * 100)
    const hi = Math.round(iv.upper * 100)
    const lean = winRatePct.value !== null && winRatePct.value > 50
      ? 'a shade above even'
      : winRatePct.value !== null && winRatePct.value < 50 ? 'a shade below even' : 'dead even'
    return {
      id: 'rigged', stat: 'p-value', q: 'Rigged MMR?',
      a: 'No — near even, measured well',
      note: `${sampleN.value} games pin your true win rate to ${lo}–${hi}% — ${lean}, far too close to even for a rigged matchmaker to be hiding in it. A slow climb looks exactly like this. (${fmtPValue(p)})`,
      tone: 'good',
    }
  }
  return {
    id: 'rigged', stat: 'p-value', q: 'Rigged MMR?',
    a: 'Too few games to tell',
    note: `At ${sampleN.value} games your record still looks like a coin flip — play more before blaming the system. (${fmtPValue(p)})`,
    tone: 'neutral',
  }
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

const checks = computed<Check[]>(() => {
  if (!projInput.value) return []
  const out: Check[] = []

  if (pValue.value !== null) {
    out.push(riggedCheck())
  }

  // The Bayesian counterpart of the p-value: start by assuming the player
  // is a pure coin flip and let the games move the odds. One probability,
  // plus the credible range — CONNECTED, so a range that straddles 50
  // reads as "more of it above even than below", not as a contradiction.
  if (skepticVerdict.value !== null && trueRateRange.value !== null) {
    const prob = Math.round(skepticVerdict.value * 100)
    const lo = Math.round(trueRateRange.value.lower * 100)
    const hi = Math.round(trueRateRange.value.upper * 100)
    const lean = prob >= 60
      ? `with more of it above even than below (${prob} to ${100 - prob}). A slow climb lives exactly in this zone`
      : prob <= 40
        ? `with more of it below even than above (${100 - prob} to ${prob}) — the playbook above is the way out`
        : 'balanced almost evenly around 50 — dead even is a real place to be, and the playbook is how you leave it'
    out.push({
      id: 'skeptic', stat: 'bayes', q: 'Better than a coin?',
      a: coinAnswer(prob),
      note: `Start from the harshest assumption — that you're a pure coin flip. Your ${sampleN.value} games move the odds to ${prob} in 100 that your true win rate beats even. The rate itself most likely sits in ${lo}–${hi}%, ${lean}.`,
      tone: prob >= 90 ? 'good' : prob <= 50 ? 'warn' : 'neutral',
    })
  }

  if (lossStreak.value !== null) {
    out.push({
      id: 'streaks', stat: 'streak', q: 'Endless loss streaks?',
      a: `${fmtPct(lossStreak.value * 100)} — normal`,
      note: `A ${streakLen}-loss streak in your next ${streakHorizon} games is ${fmtPct(lossStreak.value * 100)} likely at ${winRatePct.value}%. Expected, not rigged.`,
      tone: 'neutral',
    })
  }

  // Wald–Wolfowitz on the ACTUAL played sequence: do results cluster more
  // than an honest coin at this rate would? The direct "scripted streaks"
  // answer — and when clustering IS real, tilt is the mundane culprit.
  if (runs.value !== null) {
    const r = runs.value
    const coinLike = r.pValue >= 0.05
    out.push({
      id: 'scripted', stat: 'runs', q: 'Scripted streaks?',
      a: coinLike ? 'Coin-like — nothing scripted' : r.z < 0 ? 'Streakier than chance' : 'More alternating than chance',
      note: `Your ${r.nWins + r.nLosses} games form ${r.runs} win/loss runs; a fair sequence at your rate averages ${Math.round(r.expectedRuns)} (${fmtPValue(r.pValue)}). ${coinLike ? 'Your streaks are exactly what honest randomness produces.' : r.z < 0 ? 'Real clustering usually means tilt carrying over, not a script — see the streak rows below.' : 'Slightly more regular than random — nothing sinister about that either.'}`,
      tone: coinLike ? 'good' : 'neutral',
    })
  }

  if (percentileNow.value !== null) {
    out.push({
      id: 'hardstuck', stat: 'percentile', q: 'Hardstuck?',
      a: `Ahead of ${fmtPct(percentileNow.value)} of players`,
      note: `${rankNow.value} beats ${fmtPct(percentileNow.value)} of ranked players. ${target.value} would put you past ${fmtPct(percentileTarget.value)}. (Blizzard, July 2025)`,
      tone: 'neutral',
    })
  }

  if (probThisSeason.value !== null && seasonGames.value !== null) {
    out.push({
      id: 'season', stat: 'season', q: 'This season?',
      a: fmtProb(probThisSeason.value),
      note: `Your odds of reaching ${target.value} within about ${seasonGames.value} games — roughly 12 weeks at your pace.`,
      tone: 'neutral',
    })
  }

  return out
})
</script>

<template>
  <section v-if="checks.length > 0" class="elo-band" aria-labelledby="elo-myths-title">
    <h3 id="elo-myths-title" class="elo-band-title">
      When it feels rigged — the receipts
    </h3>
    <p class="elo-band-sub">
      The loudest "Elo Hell" complaints, checked against your own games. Read this on the nights the queue feels cursed.
    </p>
    <div class="elo-grid">
      <div v-for="c in checks" :key="c.id" class="elo-cell" :class="c.tone" :data-elo-stat="c.stat">
        <p class="elo-cell-q">
          {{ c.q }}
        </p>
        <p class="elo-cell-a">
          {{ c.a }}
        </p>
        <p class="elo-cell-note">
          {{ c.note }}
        </p>
      </div>
    </div>
  </section>
</template>

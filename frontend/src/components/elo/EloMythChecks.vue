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

const checks = computed<Check[]>(() => {
  if (!projInput.value) return []
  const out: Check[] = []

  if (pValue.value !== null) {
    const real = pValue.value < 0.05
    out.push({
      id: 'rigged', stat: 'p-value', q: 'Rigged MMR?',
      a: real ? 'No — that rate is real' : 'Too few games to tell',
      note: real
        ? `Over ${sampleN.value} games, luck alone almost never lands on ${winRatePct.value}%. (${fmtPValue(pValue.value)})`
        : `At ${sampleN.value} games your record still looks like a coin flip — play more before blaming the system. (${fmtPValue(pValue.value)})`,
      tone: real ? 'good' : 'neutral',
    })
  }

  // The Bayesian counterpart of the p-value: START from the skeptic's
  // "forced 50-50" prior and let the games argue past it. One probability,
  // plus the credible range on the true rate.
  if (skepticVerdict.value !== null && trueRateRange.value !== null) {
    const prob = Math.round(skepticVerdict.value * 100)
    const lo = Math.round(trueRateRange.value.lower * 100)
    const hi = Math.round(trueRateRange.value.upper * 100)
    out.push({
      id: 'skeptic', stat: 'bayes', q: 'Better than a coin?',
      a: prob >= 99 ? 'Almost certainly' : prob <= 1 ? 'Almost certainly not' : `${prob}% likely`,
      note: `Starting from the skeptic's own assumption — a forced 50-50 — your ${sampleN.value} games leave a ${prob}% chance your true win rate beats a coin. True win rate: most likely ${lo}–${hi}%.`,
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

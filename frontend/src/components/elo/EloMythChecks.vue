<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtRank } from '@/components/elo/elo-format'
import { buildChecks } from '@/components/elo/elo-myth-checks'

// "Is it really Elo Hell?" — the loudest complaints (rigged MMR, scripted
// streaks, endless loss runs, hardstuck) answered against the player's own
// games, plus the season-odds. Each stat leads with a plain sentence; the raw
// figure sits in a muted aside for anyone who wants it. The card copy is
// built by the pure elo-myth-checks module; this SFC only unwraps the
// calculator refs and renders.
const {
  projInput, pValue, sampleN, lossStreak, streakLen, streakHorizon,
  percentileNow, percentileTarget, probThisSeason, seasonGames, requiredWrForSeason,
  targetTier, targetDivision, currentTier, currentDivision,
  skepticVerdict, trueRateRange, runs, decay, effectiveWinRatePct,
  seasonSim, simHorizonGames, paceAssumed, provisional,
} = useEloCalc()

const rankNow = computed(() => fmtRank(currentTier.value, currentDivision.value))
const target = computed(() => fmtRank(targetTier.value, targetDivision.value))

const checks = computed(() => buildChecks({
  projInput: projInput.value,
  pValue: pValue.value,
  sampleN: sampleN.value,
  effectiveWinRatePct: effectiveWinRatePct.value,
  trueRateRange: trueRateRange.value,
  skepticVerdict: skepticVerdict.value,
  provisional: provisional.value,
  lossStreak: lossStreak.value,
  streakLen,
  streakHorizon,
  runs: runs.value,
  percentileNow: percentileNow.value,
  percentileTarget: percentileTarget.value,
  probThisSeason: probThisSeason.value,
  seasonGames: seasonGames.value,
  requiredWrForSeason: requiredWrForSeason.value,
  decay: decay.value,
  seasonSim: seasonSim.value,
  simHorizonGames: simHorizonGames.value,
  paceAssumed: paceAssumed.value,
  rankNow: rankNow.value,
  target: target.value,
}))
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

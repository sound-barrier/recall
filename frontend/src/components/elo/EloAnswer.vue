<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtRank } from '@/components/elo/elo-format'
import { deriveVerdict } from '@/components/elo/elo-verdict'

// The one loud element: a plain-English answer to "how long?". All logic
// lives in deriveVerdict (pure, branch-tested); this SFC only assembles its
// input from the calculator. Four cases: already there · Early read (too few
// decisive games to call a ceiling) · capped (the decay plateau, quoted as a
// credible RANGE with the simulator's own odds) · underranked (the median
// simulated season).
const {
  projInput, naive, decay, effectiveWinRatePct, sampleN, isEdited,
  targetTier, targetDivision, ceiling, seasonSim, simHorizonGames,
  paceAssumed, gamesPerWeekInput, currentScore, targetScore,
} = useEloCalc()

const answer = computed(() => {
  if (!projInput.value || !naive.value || !decay.value) return null
  if (effectiveWinRatePct.value === null || ceiling.value === null) return null
  if (currentScore.value === null || targetScore.value === null) return null
  const sim = seasonSim.value
  return deriveVerdict({
    target: fmtRank(targetTier.value, targetDivision.value),
    winRatePct: effectiveWinRatePct.value,
    n: sampleN.value,
    isEdited: isEdited.value,
    // A target at or BELOW the current rank is "already there" too — the
    // projection branches would render nonsense for a descent.
    alreadyThere: naive.value.expectedGames === 0 || targetScore.value <= currentScore.value,
    requiredWinRate: decay.value.requiredWinRate,
    expectedGamesDecay: decay.value.expectedGames,
    ceiling: ceiling.value,
    targetScoreLadder: targetScore.value,
    sim: sim === null ? null : {
      probReachTarget: sim.probReachTarget,
      probEndLower: sim.probEndLower,
      gamesToTargetP50: sim.gamesToTarget.p50,
      sims: sim.sims,
    },
    horizonGames: simHorizonGames.value,
    paceAssumed: paceAssumed.value,
    gamesPerWeek: gamesPerWeekInput.value,
  })
})
</script>

<template>
  <div class="elo-answer" data-elo-answer>
    <template v-if="answer">
      <p class="eyebrow elo-answer-eyebrow">
        {{ answer.eyebrow }}
      </p>
      <p class="elo-answer-head" :class="answer.tone">
        {{ answer.head }}
      </p>
      <p class="elo-answer-sub" aria-live="polite">
        {{ answer.sub }}
      </p>
    </template>
    <p v-else class="elo-answer-sub elo-answer-empty">
      Pick a track with ranked games, or type in your rank and win rate, to see how long the climb takes.
    </p>
  </div>
</template>

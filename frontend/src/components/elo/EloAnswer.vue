<script setup lang="ts">
import { computed } from 'vue'
import { useEloCalc } from '@/composables/elo/useEloCalculator'
import { fmtGames, fmtRank, fmtScoreRank, fmtWeeks } from '@/components/elo/elo-format'

// The one loud element: a plain-English answer to "how long?", adapted to the
// three cases a climber actually faces —
//   already there · underranked (climb sticks) · capped (Elo-Hell reality).
const {
  projInput, naive, decay, winRatePct, weeksNaive,
  targetTier, targetDivision,
} = useEloCalc()

const target = computed(() => fmtRank(targetTier.value, targetDivision.value))

const answer = computed(() => {
  if (!projInput.value || !naive.value || !decay.value || winRatePct.value === null) return null
  const wr = winRatePct.value

  if (naive.value.expectedGames === 0) {
    return {
      tone: 'is-good',
      eyebrow: "You're there",
      head: `${target.value} reached`,
      sub: 'Your current rank is already at or above your target — aim higher to see a projection.',
    }
  }

  // Capped: the target sits above the rank your current form implies.
  if (decay.value.requiredWinRate !== null) {
    const reqPct = decay.value.requiredWinRate * 100
    const extra = Math.max(1, Math.round(reqPct - wr))
    const ceiling = fmtScoreRank(decay.value.impliedTrueScore)
    return {
      tone: 'is-hard',
      eyebrow: 'Reality check',
      head: `Capped near ${ceiling}`,
      sub: `At ${wr}%, tougher opponents pull you back before ${target.value}. To climb past it you'd need to win about ${reqPct.toFixed(1)}% — roughly ${extra} more win${extra === 1 ? '' : 's'} per 100 games. That's improvement, not luck — and the playbook below is how you close the gap.`,
    }
  }

  // Underranked: both futures reach the target; the climb should stick.
  const ceiling = fmtScoreRank(decay.value.impliedTrueScore)
  const pace = weeksNaive.value === null ? '' : ` — ${fmtWeeks(weeksNaive.value)}`
  return {
    tone: '',
    eyebrow: 'If your form holds',
    head: fmtGames(naive.value.expectedGames),
    sub: `to reach ${target.value} at ${wr}%${pace}. Your recent form points to around ${ceiling}, so the climb should stick — you're underranked, not hardstuck. That's an effort price, not a wall; the playbook below is where those games come from.`,
  }
})
</script>

<template>
  <div class="elo-answer" data-elo-answer>
    <template v-if="answer">
      <p class="elo-answer-eyebrow">
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

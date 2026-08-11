<script setup lang="ts">
// Net rank (7 days) — total signed rank-meter movement over the last
// seven days of play (anchored on your most recent match). Climb
// velocity at a glance. In role queue this sums movement across roles.
// Opt-in.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { signJudgment } from '@/match/match-heatmap-helpers'

const { netRankWeek } = useDossier()

const tint = computed(() => {
  if (netRankWeek.value > 0) return 'kpi-up'
  return netRankWeek.value < 0 ? 'kpi-down' : ''
})
const movement = computed(() => `${netRankWeek.value > 0 ? '+' : ''}${netRankWeek.value}%`)
// Climb velocity is signed in the text but JUDGED in the tint; the
// accessible name carries the judgment word too (WCAG 1.4.1).
const spokenName = computed(() => `${movement.value} — ${signJudgment(netRankWeek.value)}`)
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Net rank (7 days)</span>
  <span class="kpi-value" :class="tint" role="img" :aria-label="spokenName">
    {{ movement }}
  </span>
</template>

<style scoped>
.kpi-up {
  color: var(--win);
}

.kpi-down {
  color: var(--loss);
}
</style>

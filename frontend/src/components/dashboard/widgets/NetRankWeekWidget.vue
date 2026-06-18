<script setup lang="ts">
// Net rank (7 days) — total signed rank-meter movement over the last
// seven days of play (anchored on your most recent match). Climb
// velocity at a glance. In role queue this sums movement across roles.
// Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const { netRankWeek } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Net rank (7 days)</span>
  <span class="kpi-value" :class="netRankWeek > 0 ? 'kpi-up' : netRankWeek < 0 ? 'kpi-down' : ''">
    {{ netRankWeek > 0 ? '+' : '' }}{{ netRankWeek }}%
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

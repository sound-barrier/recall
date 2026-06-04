<script setup lang="ts">
import { useDossier } from '../../composables/useDossier'

const { currentStreak: streak } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Current streak</span>
  <span
    class="kpi-value"
    :class="streak.result === 'victory' ? 'kpi-streak-win'
      : streak.result === 'defeat' ? 'kpi-streak-loss'
        : streak.result === 'draw' ? 'kpi-streak-draw'
          : ''"
  >
    {{ streak.result === null
      ? '—'
      : `${streak.count}${streak.result === 'victory' ? 'W' : streak.result === 'defeat' ? 'L' : 'D'}` }}
  </span>
  <span v-if="streak.sinceDate" class="kpi-sub">since {{ streak.sinceDate }}</span>
</template>

<style scoped>
/* Per-result colouring picks up the existing palette tokens so the
   streak reads in the matching W/L/D voice regardless of theme. */
.kpi-streak-win  { color: var(--win); }
.kpi-streak-loss { color: var(--loss); }
.kpi-streak-draw { color: var(--draw, var(--text-dim)); }
</style>

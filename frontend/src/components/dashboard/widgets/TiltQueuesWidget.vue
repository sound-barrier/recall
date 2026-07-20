<script setup lang="ts">
// Tilt queues — the times the player queued through 5+ straight losses in
// one sitting, with the record of every game played past the 4th loss.
// The zero case is the win: not tilt-queueing is discipline worth a KPI.
// Opt-in.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'

const { tiltQueues } = useDossier()

const tiltWinrate = computed(() => {
  const t = tiltQueues.value
  return t.tiltGames === 0 ? null : Math.round((t.tiltWins / t.tiltGames) * 100)
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Tilt queues</span>
  <span class="kpi-value">{{ tiltQueues.episodes }}</span>
  <span v-if="tiltQueues.episodes === 0" class="kpi-sub">no 5-loss sittings — discipline holds</span>
  <span v-else class="kpi-sub">
    {{ tiltQueues.tiltGames }} game<template v-if="tiltQueues.tiltGames !== 1">s</template>
    past 4 straight losses · won {{ tiltWinrate }}%
  </span>
</template>

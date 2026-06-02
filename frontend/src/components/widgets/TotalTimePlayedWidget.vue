<script setup lang="ts">
import type { TotalTimePlayed } from '../../composables/useMatchesDossier'

defineProps<{
  totalTimePlayed: TotalTimePlayed
}>()
</script>

<template>
  <span class="kpi-eyebrow">Total time played</span>
  <span class="kpi-value">{{ totalTimePlayed.label }}</span>
  <!-- Surface coverage when not every record contributed a
       game_length — the sum is honest about what data fed it so the
       user knows whether "20min" is "20 across the whole narrow" or
       "20 across the 2 of 4 with data." -->
  <span
    v-if="totalTimePlayed.recordsWithTime > 0
      && totalTimePlayed.recordsWithTime < totalTimePlayed.recordsTotal"
    class="kpi-sub"
  >
    {{ totalTimePlayed.recordsWithTime }} of {{ totalTimePlayed.recordsTotal }} matches
  </span>
</template>

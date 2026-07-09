<script setup lang="ts">
import { useEloCalc } from '@/composables/elo/useEloCalculator'

// Rank-track picker. Overwatch keeps a separate rank per role plus one for
// open queue; picking a track refills the whole form from that track's own
// games — like changing which loan you're pricing.
const { track, tracks, setTrack } = useEloCalc()
</script>

<template>
  <div class="elo-tracks" role="group" aria-label="Rank track">
    <button
      v-for="t in tracks"
      :key="t.key"
      type="button"
      class="elo-track-btn"
      :class="{ picked: track === t.key }"
      :aria-pressed="track === t.key ? 'true' : 'false'"
      :data-elo-track="t.key"
      :disabled="t.decisiveN === 0 && !t.hasRank"
      :title="t.decisiveN === 0 && !t.hasRank ? 'No competitive games on this track yet' : `${t.decisiveN} ranked games`"
      @click="setTrack(t.key)"
    >
      {{ t.label }}<span class="elo-track-n" aria-hidden="true">{{ t.decisiveN }}</span>
    </button>
  </div>
</template>

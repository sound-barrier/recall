<script setup lang="ts">
// Fresh queue vs tilted queue.
//
// Does queuing straight back in after a game cost you, compared with coming
// back after a break? The app has always binarized the gap into sessions; this
// is the first thing that reads its SIZE.
//
// The band between the two thresholds is in neither side on purpose: a
// twenty-minute gap is not a re-queue and not a break, and forcing it into one
// would fill both with the least meaningful matches.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { FRESH_GAP_MINUTES, TILTED_GAP_MINUTES } from '@/match/dossier/match-queue-gap-helpers'

const dossier = useDossier()
const split = dossier.queueGapSplit()

const rows = computed(() => [
  { key: `Straight back in (under ${TILTED_GAP_MINUTES} min)`, ...split.value.tilted },
  { key: `After a break (over ${FRESH_GAP_MINUTES} min)`, ...split.value.fresh },
])

const anySample = computed(() => rows.value.some((r) => r.sample > 0))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Fresh vs tilted queue</span>
  </header>
  <p v-if="!anySample" class="kpi-sub">
    Not enough back-to-back games to compare.
  </p>
  <ul v-else>
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          role="progressbar"
          :aria-valuenow="row.winrate ?? 0"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${row.key} winrate`"
          :style="{ width: (row.winrate ?? 0) + '%' }"
        />
        <span class="bd-time">{{ row.sample }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate === null ? 'no games' : `${row.winrate}%` }}</span>
    </li>
  </ul>
</template>

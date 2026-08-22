<script setup lang="ts">
// Judges each window by WIN RATE ("when do I win"), keeping the bar
// width as the volume share ("when do I play") — same volume-vs-
// judgment split the bands use. The meter's value is the share, so
// the win-rate band has nowhere else to live: it rides the accessible
// NAME, in the vocabulary every judged surface shares.
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { timeOfDaySchema, type TimeOfDayConfig } from '@/dashboard/widget-schemas'
import { bucketCellClass, bucketCellJudgment } from '@/match/trends/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<TimeOfDayConfig>('time-of-day', timeOfDaySchema)
const buckets = dossier.timeOfDayBuckets(() => ({ bucketCount: config.value.bucketCount }))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Time of day</span>
  </header>
  <ul>
    <li v-for="b in buckets" :key="b.label">
      <span class="bd-name">{{ b.label }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          :class="bucketCellClass(b)"
          role="progressbar"
          :aria-valuenow="Math.round(b.share)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${b.label} share — ${bucketCellJudgment(b)}`"
          :style="{ width: b.share + '%' }"
        />
        <span class="bd-time">{{ b.count }}x</span>
      </span>
      <span class="bd-stats">{{ b.winrate === null ? '—' : `${b.winrate}%` }}</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { useDossier } from '../../composables/useDossier'
import { useWidgetConfig } from '../../composables/useWidgetConfig'
import { timeOfDaySchema, type TimeOfDayConfig } from '../../dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<TimeOfDayConfig>('time-of-day', timeOfDaySchema)
const buckets = dossier.timeOfDayBuckets(() => ({ bucketCount: config.value.bucketCount }))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Time of day</span>
  </header>
  <ul>
    <li v-for="b in buckets" :key="b.label">
      <span class="bd-name">{{ b.label }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: b.share + '%' }" />
        <span class="bd-time">{{ b.count }}x</span>
      </span>
      <span class="bd-stats">{{ b.share }}%</span>
    </li>
  </ul>
</template>

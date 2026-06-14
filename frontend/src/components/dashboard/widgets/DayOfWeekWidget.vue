<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { dayOfWeekSchema, type DayOfWeekConfig } from '@/dashboard/widgets'
import type { WeekStart } from '@/match-time-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<DayOfWeekConfig>('day-of-week', dayOfWeekSchema)

// 'inherit' lets the dossier-level useWeekStart preference win.
// Other values pin a per-widget override (e.g. compare a Monday-
// anchored scrim week against the rest of the dossier's calendar).
function mapWeekStart(v: DayOfWeekConfig['weekStartOverride']): WeekStart | undefined {
  if (v === 'monday') return 1
  if (v === 'sunday') return 0
  return undefined
}

const buckets = dossier.dayOfWeekBuckets(() => ({
  weekStartOverride: mapWeekStart(config.value.weekStartOverride),
}))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Day of week</span>
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

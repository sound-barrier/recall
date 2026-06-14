<script setup lang="ts">
import { computed } from 'vue'
import { useDossier } from '@/composables/useDossier'
import { useWidgetConfig } from '@/composables/useWidgetConfig'
import { totalTimeSchema, type TotalTimeConfig } from '@/dashboard/widgets'
import { formatPlayMinutes } from '@/match-time-helpers'

const { totalTimePlayed } = useDossier()
const { config } = useWidgetConfig<TotalTimeConfig>('total-time', totalTimeSchema)

// Local format pass per the user's unit choice. The dossier's
// pre-formatted label is the 'hh:mm' default; the other modes
// re-derive from the raw minutes so we don't have to expose three
// pre-built labels from the dossier itself.
const displayLabel = computed(() => {
  if (totalTimePlayed.value.recordsWithTime === 0) return '—'
  const minutes = totalTimePlayed.value.minutes
  switch (config.value.unit) {
    case 'h':
      return `${Math.round(minutes / 60)}h`
    case 'd-h': {
      const hours = Math.floor(minutes / 60)
      const days  = Math.floor(hours / 24)
      const rem   = hours - days * 24
      if (days === 0) return `${rem}h`
      return `${days}d ${rem}h`
    }
    case 'hh:mm':
    default:
      return formatPlayMinutes(minutes)
  }
})
</script>

<template>
  <span class="kpi-eyebrow">Total time played</span>
  <span class="kpi-value">{{ displayLabel }}</span>
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

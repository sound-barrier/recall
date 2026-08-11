<script setup lang="ts">
// Recent form — win rate over the last N decisive games with the
// signed gap vs the overall rate. The climb thermometer: a positive
// gap means the current stretch is beating your baseline. Ships in
// the default row-1 KPI set.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { formDeltaSchema, type FormDeltaConfig } from '@/dashboard/widgets'
import { signJudgment } from '@/match/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<FormDeltaConfig>('form-delta', formDeltaSchema)
const form = dossier.formDelta(() => ({ window: config.value.window }))

const gapClass = computed(() => {
  const gap = form.value.deltaPts
  if (gap === null || gap === 0) return ''
  return gap > 0 ? 'gap-up' : 'gap-down'
})

// The tint is the only thing separating "beating your baseline" from
// "below it"; role="img" + the shared band word says which (WCAG 1.4.1).
const gapText = computed(() => {
  const gap = form.value.deltaPts
  return gap === null ? '' : `${gap > 0 ? '+' : ''}${gap} pts`
})
const gapName = computed(() => {
  const gap = form.value.deltaPts
  return gap === null ? undefined : `${gapText.value} — ${signJudgment(gap)}`
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Recent form</span>
  <span class="kpi-value">{{ form.recent.winrate === null ? '—' : `${form.recent.winrate}%` }}</span>
  <!-- "n=" mirrors the Winrate tile's sample vocabulary. -->
  <span v-if="form.deltaPts !== null" class="kpi-sub">
    <span class="form-gap" :class="gapClass" role="img" :aria-label="gapName">{{ gapText }}</span>
    vs {{ form.overall.winrate }}% overall · n={{ form.recent.sample }}
  </span>
</template>

<style scoped>
.gap-up {
  color: var(--win);
  font-weight: 700;
}

.gap-down {
  color: var(--loss);
  font-weight: 700;
}
</style>

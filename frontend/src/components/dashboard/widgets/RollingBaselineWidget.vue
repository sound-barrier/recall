<script setup lang="ts">
// This week against the player's own trailing average, reported as a
// standardized difference rather than a raw gap.
//
// A raw gap lies about small samples: three matches swinging twenty points and
// forty matches moving six read identically, and only one of them means
// anything. Below the sample floor this says so instead of printing a number.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { rollingBaselineSchema, type RollingBaselineConfig } from '@/dashboard/widgets'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'

const dossier = useDossier()
const { config } = useWidgetConfig<RollingBaselineConfig>('rolling-baseline', rollingBaselineSchema)
const delta = dossier.rollingBaseline(() => ({
  recentDays: config.value.recentDays,
  baselineDays: config.value.baselineDays,
}))

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`)

const sigmaText = computed(() => {
  const s = delta.value.sigma
  return s === null ? '' : `${s > 0 ? '↑ +' : '↓ '}${s.toFixed(1)}σ`
})
const tint = computed(() => {
  const s = delta.value.sigma
  if (s === null) return ''
  return s > 0 ? 'tint-up' : 'tint-down'
})
// The tint is the only cue separating better from worse, so the band word
// rides in the accessible name (WCAG 1.4.1).
const sigmaName = computed(() =>
  delta.value.sigma === null ? undefined : `${sigmaText.value} — ${signJudgment(delta.value.sigma)}`)

const detail = computed(() => {
  const d = delta.value
  if (d.sigma === null) {
    return `Not enough games to compare — ${d.recentN} recent vs ${d.baselineN} before.`
  }
  return `vs ${pct(d.baselineRate)} baseline · n=${d.recentN}`
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Vs your baseline</span>
  <span class="kpi-value">{{ pct(delta.recentRate) }}</span>
  <span class="kpi-sub">
    <span v-if="sigmaText" class="rb-sigma" :class="tint" role="img" :aria-label="sigmaName">{{ sigmaText }}</span>
    {{ detail }}
  </span>
</template>

<style scoped>
.rb-sigma {
  font-weight: 700;
}
</style>

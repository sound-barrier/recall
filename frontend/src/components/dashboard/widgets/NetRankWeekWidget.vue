<script setup lang="ts">
// Net rank (7 days) — total signed rank-meter movement over the last
// seven days of play (anchored on your most recent match). Climb
// velocity at a glance. In role queue this sums movement across roles.
// Opt-in.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'

const { netRankWeek } = useDossier()

// The shared sign tint (styles/verdict-tint.css), same pair as the
// Recent-form gap.
const tint = computed(() => {
  if (netRankWeek.value.netPercent > 0) return 'tint-up'
  return netRankWeek.value.netPercent < 0 ? 'tint-down' : ''
})
const movement = computed(() => `${netRankWeek.value.netPercent > 0 ? '+' : ''}${netRankWeek.value.netPercent}%`)
// Climb velocity is signed in the text but JUDGED in the tint; the
// accessible name carries the judgment word too (WCAG 1.4.1).
const spokenName = computed(() =>
  `${movement.value} — ${signJudgment(netRankWeek.value.netPercent)}${coverage.value}`)

// What the total was actually built from. change_percent is nullable, so a week
// whose rank screens mostly went unread would otherwise print a small number
// that reads as a quiet week rather than as a thin sample.
const coverage = computed(() => {
  const { readCount, totalCount } = netRankWeek.value
  if (totalCount === 0 || readCount === totalCount) return ''
  return `, from ${readCount} of ${totalCount} matches`
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Net rank (7 days)</span>
  <span class="kpi-value" :class="tint" role="img" :aria-label="spokenName">
    {{ movement }}
  </span>
  <span v-if="coverage" class="kpi-sub">{{ netRankWeek.readCount }}/{{ netRankWeek.totalCount }} read</span>
</template>

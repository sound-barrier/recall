<script setup lang="ts">
// "Did the rank follow the play?" — the week's win rate against the player's
// OWN trailing baseline, set beside how the rank actually moved.
//
// Answers the suspicion every ranked player has ("I'm playing well and going
// nowhere") with their own numbers, and answers the flattering version of it
// too. It refuses to answer when it cannot: an unread movement pill is not a
// rank that failed to move, and a handful of games is not a trend.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { perfVsRankSchema, type PerfVsRankConfig } from '@/dashboard/widget-schemas'

const dossier = useDossier()
const { config } = useWidgetConfig<PerfVsRankConfig>('perf-vs-rank', perfVsRankSchema)
const result = dossier.perfVsRank(() => ({
  recentDays: config.value.recentDays,
  baselineDays: 30,
}))

// The verdict IS the value — the number alone ("+1.4σ") answers a question
// nobody asked.
const VERDICT_TEXT: Record<string, string> = {
  deflation: 'Playing above your baseline, rank flat',
  lucky: 'Rank climbed on a below-baseline week',
  matched: 'Rank is following the play',
  unknown: 'Not enough to say',
}
const verdict = computed(() => VERDICT_TEXT[result.value.verdict] ?? VERDICT_TEXT.unknown)

const tint = computed(() => {
  if (result.value.verdict === 'deflation') return 'tint-down'
  return result.value.verdict === 'lucky' ? 'tint-up' : ''
})

// Says WHY it is silent, so "Not enough to say" is never mistaken for
// "nothing happened".
const detail = computed(() => {
  const { delta, netPercent, readCount } = result.value
  if (delta.sigma === null) {
    return `Needs more games either side — ${delta.recentN} recent, ${delta.baselineN} before.`
  }
  if (netPercent === null) {
    const { readOf } = result.value
    return readCount === 0
      ? 'No rank movement was read in the window, so there is nothing to compare the play against.'
      : `Only ${readCount} of ${readOf} matches reported a rank movement — too thin to judge the week by.`
  }
  const sigma = `${delta.sigma > 0 ? '+' : ''}${delta.sigma.toFixed(1)}σ`
  const moved = `${netPercent > 0 ? '+' : ''}${netPercent}%`
  return `${sigma} vs your 30-day baseline, rank ${moved} across ${readCount} readings.`
})
</script>

<template>
  <span class="eyebrow kpi-eyebrow">Play vs rank</span>
  <span class="kpi-value pvr-verdict" :class="tint" role="img" :aria-label="verdict">
    {{ verdict }}
  </span>
  <span class="kpi-sub">{{ detail }}</span>
</template>

<style scoped>
/* The verdict is a sentence, not a figure — it must not inherit the numeric
   tile's display scale or it wraps to four lines. */
.pvr-verdict {
  font-size: var(--type-md);
  font-weight: 700;
  line-height: 1.25;
}
</style>

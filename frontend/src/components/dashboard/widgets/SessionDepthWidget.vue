<script setup lang="ts">
// Session depth — win rate by how deep into a play session the game
// was. Where the late buckets sag is where stopping earlier starts
// paying. Bar width is the share of games at that depth; color is
// the bands' shared win-rate judgment. Gallery opt-in.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'
import { bucketCellClass } from '@/match/match-heatmap-helpers'

const dossier = useDossier()
const depth = dossier.sessionDepth

const rows = computed(() => {
  const buckets = depth.value.buckets
  const total = buckets.reduce((sum, b) => sum + b.sample, 0)
  return buckets.map((b, i) => ({
    label: i === buckets.length - 1 ? `Game ${b.index}+` : `Game ${b.index}`,
    share: total === 0 ? 0 : Math.round((b.sample / total) * 100),
    judgment: bucketCellClass({ count: b.sample, wins: b.wins, decisive: b.sample }),
    winrate: b.winrate,
    sample: b.sample,
  }))
})
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Session depth</span>
  </header>
  <ul>
    <li v-for="row in rows" :key="row.label">
      <span class="bd-name">{{ row.label }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :class="row.judgment" :style="{ width: row.share + '%' }" />
        <span class="bd-time">{{ row.sample }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate === null ? '—' : `${row.winrate}%` }}</span>
    </li>
  </ul>
</template>

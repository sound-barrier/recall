<script setup lang="ts">
// First game of session — win-rate of each play session's opening game
// (a new session starts after a multi-hour gap). Surfaces warm-up
// effects. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const { firstGameWinrate } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">First game of session</span>
  <span class="kpi-value">{{ firstGameWinrate.winrate === null ? '—' : firstGameWinrate.winrate + '%' }}</span>
  <span v-if="firstGameWinrate.sample > 0" class="kpi-sub">
    win-rate over {{ firstGameWinrate.sample }} session<span v-if="firstGameWinrate.sample !== 1">s</span>
  </span>
</template>

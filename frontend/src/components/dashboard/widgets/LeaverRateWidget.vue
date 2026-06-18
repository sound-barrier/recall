<script setup lang="ts">
// Leaver rate — share of matches you flagged with a leaver (any side).
// Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const { leaverStats } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Leaver rate</span>
  <span class="kpi-value">{{ leaverStats.rate === null ? '—' : leaverStats.rate + '%' }}</span>
  <span v-if="leaverStats.total > 0" class="kpi-sub">{{ leaverStats.leaverCount }} of {{ leaverStats.total }}</span>
</template>

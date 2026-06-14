<script setup lang="ts">
import { useDossier } from '@/composables/useDossier'

const { averageKDA } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Avg K/D/A per 10min</span>
  <!-- K/D/A = Kills (eliminations) / Deaths / Assists, the canonical
       gaming-stat order. Each match's avg_per_10min is straight-
       averaged across qualifying records so each match counts equally
       regardless of duration. The W/L/D record stays surfaced in the
       masthead scoreboard. -->
  <span class="kpi-value kda-value">{{ averageKDA?.label ?? '—' }}</span>
  <span
    v-if="averageKDA && averageKDA.qualifyingMatches < averageKDA.recordsTotal"
    class="kpi-sub"
  >
    {{ averageKDA.qualifyingMatches }} of {{ averageKDA.recordsTotal }} matches
  </span>
</template>

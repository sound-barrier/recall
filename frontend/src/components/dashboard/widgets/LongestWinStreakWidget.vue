<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'

const { longestWinStreak: count } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Longest win streak</span>
  <span class="kpi-value">{{ count > 0 ? count : '—' }}</span>
  <span v-if="count > 0" class="kpi-sub">
    win<span v-if="count !== 1">s</span>
  </span>
</template>

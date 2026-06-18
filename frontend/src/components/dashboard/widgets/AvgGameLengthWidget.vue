<script setup lang="ts">
// Average game length — mean match duration (MM:SS) over matches that
// recorded a game length. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'
import { formatMinutesAsClock } from '@/match/match-time-helpers'

const { avgGameLength } = useDossier()
</script>

<template>
  <span class="kpi-eyebrow">Avg game length</span>
  <span class="kpi-value">{{ formatMinutesAsClock(avgGameLength) }}</span>
</template>

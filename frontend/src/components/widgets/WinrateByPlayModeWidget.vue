<script setup lang="ts">
// Winrate by play mode — same 3 rows as the share widget, but the
// bar fill is winrate (not share) and the right-side stat reports
// winrate%. The count overlay (bd-time) still shows match count so
// the user can read sample size at a glance (100% winrate over 1
// match is noise; over 50 matches is signal). Non-default; users
// opt in via the dossier customize gallery.
import { useDossier } from '@/composables/useDossier'

const dossier = useDossier()
const playModeBreakdown = dossier.playModeBreakdown
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Winrate by play mode</span>
  </header>
  <ul>
    <li v-for="row in playModeBreakdown" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.winrate + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%</span>
    </li>
  </ul>
</template>

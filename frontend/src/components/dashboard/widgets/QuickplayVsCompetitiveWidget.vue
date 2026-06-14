<script setup lang="ts">
// Quickplay vs Competitive — share-of-matches breakdown. Three fixed
// rows so the layout never reflows: quickplay, competitive, and an
// "—" bar for matches whose play_mode hasn't been pinned (no
// override, no parser hint, no rank-row inference). Non-default;
// users opt in via the dossier customize gallery.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const playModeBreakdown = dossier.playModeBreakdown
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Quickplay vs Competitive</span>
  </header>
  <ul>
    <li v-for="row in playModeBreakdown" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.share + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.share }}%</span>
    </li>
  </ul>
</template>

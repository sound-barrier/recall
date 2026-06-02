<script setup lang="ts">
import type { BreakdownEntry } from '../../composables/useMatchesDossier'

defineProps<{
  topMaps: readonly BreakdownEntry[]
}>()
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Most played maps</span>
  </header>
  <ul>
    <li v-for="m in topMaps" :key="m.key">
      <span class="bd-name">{{ m.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: m.share + '%' }" />
        <span class="bd-time">{{ m.total }}x</span>
      </span>
      <span class="bd-stats">{{ m.share }}%</span>
    </li>
  </ul>
</template>

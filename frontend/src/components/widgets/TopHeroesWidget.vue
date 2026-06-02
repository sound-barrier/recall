<script setup lang="ts">
import type { HeroBreakdownEntry } from '../../composables/useMatchesDossier'

defineProps<{
  topHeroes: readonly HeroBreakdownEntry[]
}>()
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Most played heroes</span>
  </header>
  <ul>
    <li v-for="h in topHeroes" :key="h.key">
      <span class="bd-name">{{ h.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: h.share + '%' }" />
        <span class="bd-time">{{ h.timeLabel }}</span>
      </span>
      <span class="bd-stats">{{ h.share }}%</span>
    </li>
  </ul>
</template>

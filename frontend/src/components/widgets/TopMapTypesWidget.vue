<script setup lang="ts">
import type { BreakdownEntry } from '../../composables/useMatchesDossier'

defineProps<{
  topMapTypes: readonly BreakdownEntry[]
}>()
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Most played map types</span>
  </header>
  <ul>
    <li v-for="t in topMapTypes" :key="t.key">
      <span class="bd-name">{{ t.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: t.share + '%' }" />
        <span class="bd-time">{{ t.total }}x</span>
      </span>
      <span class="bd-stats">{{ t.share }}%</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { BucketEntry } from '../../composables/useMatchesDossier'

defineProps<{
  buckets: readonly BucketEntry[]
}>()
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Day of week</span>
  </header>
  <ul>
    <li v-for="b in buckets" :key="b.label">
      <span class="bd-name">{{ b.label }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: b.share + '%' }" />
        <span class="bd-time">{{ b.count }}x</span>
      </span>
      <span class="bd-stats">{{ b.share }}%</span>
    </li>
  </ul>
</template>

<script setup lang="ts">
import type { RoleBreakdownEntry } from '../../composables/useMatchesDossier'

defineProps<{
  topRoles: readonly RoleBreakdownEntry[]
}>()
</script>

<template>
  <!-- Role-share row. Bars are sized by `count / total matches` so
       open-queue matches (multiple roles per match) push the row's
       sum past 100% — that's the desired signal, not a bug. The bar
       carries the raw match count ("3x") and the right-side column
       carries the share percentage, mirroring topMaps' layout so the
       three breakdowns read as one consistent grid. Title-tip on the
       bar surfaces the per-role winrate for power users. -->
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Most played roles</span>
  </header>
  <ul>
    <li v-for="r in topRoles" :key="r.key">
      <span class="bd-name">{{ r.key }}</span>
      <span class="bd-bar" :title="r.total > 0 ? `${r.winrate}% winrate` : undefined">
        <span class="bd-fill" :style="{ width: Math.min(r.share, 100) + '%' }" />
        <span class="bd-time">{{ r.total }}x</span>
      </span>
      <span class="bd-stats">{{ r.share }}%</span>
    </li>
  </ul>
</template>

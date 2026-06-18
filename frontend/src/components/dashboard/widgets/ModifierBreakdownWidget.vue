<script setup lang="ts">
// Match modifiers — count + win-rate per non-result rank-update pill
// (uphill battle, reversal, consolation, win/loss streak, calibration,
// volatile, demotion protection). A match carries several modifiers, so
// the buckets overlap by design. Bar fill is the modifier's share of all
// modifier appearances; the % is its win-rate. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const rows = dossier.modifierBreakdown(() => ({ limit: 12 }))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Match modifiers</span>
  </header>
  <ul>
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name mod-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.share + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%</span>
    </li>
  </ul>
</template>

<style scoped>
.mod-name {
  text-transform: capitalize;
}
</style>

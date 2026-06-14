<script setup lang="ts">
// Win rate by teammate — one row per player you've tagged onto a match
// (annotation.members) plus a "Solo" baseline, ranked by games together.
// The bar fill is win RATE (the comparison axis — "who do I actually win
// with") while the in-bar count reports sample size, since a 100% win
// rate over one game is noise and over fifty is signal. Opt-in: users
// add it from the dossier customize gallery.
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { withWhomSchema, type TopByCountConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<TopByCountConfig>('with-whom', withWhomSchema)

const rows = dossier.withWhomBreakdown(() => ({ limit: config.value.limit }))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Win rate by teammate</span>
  </header>
  <ul v-if="rows.length">
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.winrate + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%</span>
    </li>
  </ul>
  <p v-else class="breakdown-empty">
    Tag teammates on your matches to compare win rate by who you played with.
  </p>
</template>

<style scoped>
.breakdown-empty {
  margin: 0;
  padding: 0.45rem 0;
  font-size: 0.78rem;
  font-style: italic;
  color: var(--text-faint);
}
</style>

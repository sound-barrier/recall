<script setup lang="ts">
import { useDossier, useFullDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { topMapsSchema, type TopByCountConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const fullDossier = useFullDossier()
const { config } = useWidgetConfig<TopByCountConfig>('top-maps', topMapsSchema)

// Reactive query — passes a getter so config changes propagate
// through Vue's reactivity into the dossier's computed cache.
const topMaps = dossier.topByCount(() => ({
  getter: (r) => r.data?.map,
  limit:  config.value.limit,
}))
// Reserve height to the UNFILTERED row count (capped at the limit) rather than
// the raw limit, so a player with only a few maps sees no empty padding while a
// filter that hides rows still holds the height steady. See the placeholder loop.
const reserveRows = fullDossier.topByCount(() => ({
  getter: (r) => r.data?.map,
  limit:  config.value.limit,
}))
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
    <li
      v-for="i in Math.max(0, reserveRows.length - topMaps.length)"
      :key="`ph-${i}`"
      class="bd-placeholder"
      aria-hidden="true"
    />
  </ul>
</template>

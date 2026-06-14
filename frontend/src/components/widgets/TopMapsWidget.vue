<script setup lang="ts">
import { useDossier } from '@/composables/useDossier'
import { useWidgetConfig } from '@/composables/useWidgetConfig'
import { topMapsSchema, type TopByCountConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<TopByCountConfig>('top-maps', topMapsSchema)

// Reactive query — passes a getter so config changes propagate
// through Vue's reactivity into the dossier's computed cache.
const topMaps = dossier.topByCount(() => ({
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
  </ul>
</template>

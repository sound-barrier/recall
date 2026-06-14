<script setup lang="ts">
import { useDossier } from '@/composables/useDossier'
import { useWidgetConfig } from '@/composables/useWidgetConfig'
import { topGameModesSchema, type TopByCountConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<TopByCountConfig>('top-game-modes', topGameModesSchema)
const topGameModes = dossier.topByCount(() => ({
  getter: (r) => r.data?.game_mode,
  limit:  config.value.limit,
}))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Most played game modes</span>
  </header>
  <ul>
    <li v-for="t in topGameModes" :key="t.key">
      <span class="bd-name">{{ t.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: t.share + '%' }" />
        <span class="bd-time">{{ t.total }}x</span>
      </span>
      <span class="bd-stats">{{ t.share }}%</span>
    </li>
  </ul>
</template>

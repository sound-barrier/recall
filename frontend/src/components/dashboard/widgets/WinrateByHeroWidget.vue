<script setup lang="ts">
// Win-rate by hero — heroes ranked best → worst by win-rate, gated on a
// minimum decisive-match sample so noise doesn't top the list. Bar fill
// is win-rate; the count overlay shows the sample. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { winrateBySchema, type WinrateByConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<WinrateByConfig>('winrate-by-hero', winrateBySchema)

const rows = dossier.winrateBy(() => ({
  getter:     (r) => r.data?.hero,
  minMatches: config.value.minMatches,
  limit:      config.value.limit,
}))
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Win-rate by hero</span>
  </header>
  <ul>
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.winrate + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%</span>
    </li>
  </ul>
</template>

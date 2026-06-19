<script setup lang="ts">
import { useDossier, useFullDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { topHeroesSchema, type TopByCountConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const fullDossier = useFullDossier()
const { config } = useWidgetConfig<TopByCountConfig>('top-heroes', topHeroesSchema)
const topHeroes = dossier.topHeroesByMinutes(() => ({ limit: config.value.limit }))
// Reserve to the UNFILTERED hero count (capped at the limit) — no empty padding
// for a small pool, steady height when a filter trims rows. See the placeholder loop.
const reserveRows = fullDossier.topHeroesByMinutes(() => ({ limit: config.value.limit }))
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
    <li
      v-for="i in Math.max(0, reserveRows.length - topHeroes.length)"
      :key="`ph-${i}`"
      class="bd-placeholder"
      aria-hidden="true"
    />
  </ul>
</template>

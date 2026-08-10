<script setup lang="ts">
// Win-rate by hero — heroes ranked best → worst by win-rate, gated on a
// minimum decisive-match sample so noise doesn't top the list. Bar fill
// is win-rate; the count overlay shows the sample. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'
import { wilsonMargin } from '@/match/match-sample-helpers'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { winrateBySchema, type WinrateByConfig } from '@/dashboard/widgets'

const dossier = useDossier()
const { config } = useWidgetConfig<WinrateByConfig>('winrate-by-hero', winrateBySchema)

const rows = dossier.winrateBy(() => ({
  getter:     (r) => r.data?.hero,
  minMatches: config.value.minMatches,
  limit:      config.value.limit,
}))

// Wilson ± (pct points) inline while the sample is thin enough for it
// to matter; solid samples (n ≥ 30) keep the clean single number.
function ciMargin(row: { wins?: number, total: number }): number | null {
  if (row.wins == null || row.total >= 30) return null
  return wilsonMargin(row.wins, row.total)
}
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Win-rate by hero</span>
  </header>
  <ul>
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          role="progressbar"
          :aria-valuenow="Math.round(row.winrate)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${row.key} winrate`"
          :style="{ width: row.winrate + '%' }"
        />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%<span v-if="ciMargin(row)" class="bd-ci"> ±{{ ciMargin(row) }}</span></span>
      <span
        v-if="row.lowSample"
        data-low-sample
        class="bd-low-n"
        :title="`Only ${row.total} decisive matches — treat this rate as noisy`"
      >n&lt;5</span>
    </li>
  </ul>
</template>

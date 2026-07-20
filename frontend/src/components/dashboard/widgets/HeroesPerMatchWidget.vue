<script setup lang="ts">
import { useDossier } from '@/composables/dashboard/useDossier'
import { useWidgetConfig } from '@/composables/dashboard/useWidgetConfig'
import { heroDisciplineSchema, type HeroDisciplineConfig } from '@/dashboard/widgets'

// Heroes per match — how many games were played on 1 / 2 / 3 / 4+ heroes and
// how each bucket converts. A hero under the threshold percent of the match
// (touched the point) doesn't count as meaningfully played.

const dossier = useDossier()
const { config } = useWidgetConfig<HeroDisciplineConfig>('heroes-per-match', heroDisciplineSchema)

const rows = dossier.heroCountBuckets(() => ({ thresholdPct: config.value.thresholdPct }))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Heroes per match</span>
  </header>
  <ul v-if="rows.length > 0">
    <li v-for="row in rows" :key="row.key">
      <span class="bd-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.winrate + '%' }" />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.winrate }}%</span>
      <span
        v-if="row.lowSample"
        data-low-sample
        class="bd-low-n"
        :title="`Only ${row.total} matches in this bucket — treat this rate as noisy`"
      >n&lt;5</span>
    </li>
  </ul>
  <!-- .breakdown-empty, not .bd-placeholder: the latter is the INVISIBLE
       height-filler class the top-N widgets use (visibility: hidden). -->
  <p v-else class="breakdown-empty">
    No matches with a known hero yet.
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

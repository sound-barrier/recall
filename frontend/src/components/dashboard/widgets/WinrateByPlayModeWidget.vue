<script setup lang="ts">
// Winrate by play mode — same 3 rows as the share widget, but the
// bar fill is winrate (not share) and the right-side stat reports
// winrate%. The count overlay (bd-time) still shows match count so
// the user can read sample size at a glance (100% winrate over 1
// match is noise; over 50 matches is signal). Non-default; users
// opt in via the dossier customize gallery.
import { useDossier } from '@/composables/dashboard/useDossier'
import { wilsonMargin } from '@/match/match-sample-helpers'

const dossier = useDossier()
const playModeBreakdown = dossier.playModeBreakdown

// Wilson ± (pct points) inline while the sample is thin enough for it
// to matter; solid samples (n ≥ 30) keep the clean single number.
function ciMargin(row: { wins?: number, total: number }): number | null {
  if (row.wins == null || row.total >= 30) return null
  return wilsonMargin(row.wins, row.total)
}
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Winrate by play mode</span>
  </header>
  <ul>
    <li v-for="row in playModeBreakdown" :key="row.key">
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
    </li>
  </ul>
</template>

<script setup lang="ts">
// Ranked above — the share of the population below the player's current rank,
// read straight off the season-4 rank screen's "HIGHER RANKED THAN N% OF
// PLAYERS" caption rather than modeled from a distribution. That distinction
// is the whole reason this widget can exist: the old Elo population card was
// DELETED (a928122f) because Blizzard's published distribution had been voided
// by the Emerald redistribution and there was nothing honest to replace it
// with. This is per-screenshot ground truth.
//
// One row per role bucket, mirroring Current rank — role queue tracks a
// separate rank per role, so a single headline number would have to pick a
// winner and would silently hide the others.
import { computed } from 'vue'

import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()

// Only rows whose reading actually carried the caption. A placement screen has
// no percentile because there is no settled rank to be a percentile of, and
// every capture predating season 4 has none either — showing those as 0%
// would state that the player is ranked above nobody.
const rows = computed(() => dossier.currentRank.value.filter((r) => r.percentile != null))
const hasRankButNoPercentile = computed(
  () => rows.value.length === 0 && dossier.currentRank.value.length > 0,
)
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Ranked above</span>
  </header>
  <ul v-if="rows.length">
    <li v-for="r in rows" :key="r.key">
      <span class="bd-name">{{ r.label }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          role="progressbar"
          :aria-valuenow="r.percentile ?? 0"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${r.label} — ranked above this share of players`"
          :style="{ width: (r.percentile ?? 0) + '%' }"
        />
        <span class="bd-time cap">{{ r.tier }} {{ r.level }}</span>
      </span>
      <span class="bd-stats">{{ r.percentile }}%</span>
    </li>
  </ul>
  <!-- Two different empties, because they call for two different actions:
       one needs a rank screenshot at all, the other needs a NEWER one. -->
  <p v-else-if="hasRankButNoPercentile" class="rp-empty">
    No population reading yet — Overwatch began printing it in season 4, so a
    rank screenshot from this season will fill it in.
  </p>
  <p v-else class="rp-empty">
    No rank readings yet — capture a competitive rank screenshot.
  </p>
</template>

<style scoped>
.rp-empty {
  margin: 0;
  font-size: var(--type-xs);
  color: var(--text-dim);
  line-height: 1.5;
}
</style>

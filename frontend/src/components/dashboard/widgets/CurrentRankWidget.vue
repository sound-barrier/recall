<script setup lang="ts">
// Current rank — the latest rank reading per role (role queue tracks a
// separate rank per role; open queue is one line). The bar shows
// progress within the division; the overlay names the tier + division.
// Opt-in via the dossier customize gallery; empty until a competitive
// rank screenshot is parsed.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const currentRank = dossier.currentRank
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Current rank</span>
  </header>
  <ul v-if="currentRank.length">
    <li v-for="r in currentRank" :key="r.key">
      <span class="bd-name">{{ r.label }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: Math.max(0, r.progress) + '%' }" />
        <span class="bd-time cap">{{ r.tier }} {{ r.level }}</span>
      </span>
      <span class="bd-stats">{{ r.progress }}%</span>
    </li>
  </ul>
  <p v-else class="cr-empty">
    No rank readings yet — capture a competitive rank screenshot.
  </p>
</template>

<style scoped>
.cap {
  text-transform: capitalize;
}

.cr-empty {
  margin: 0;
  color: var(--text-dim);
  font-size: 0.85rem;
}
</style>

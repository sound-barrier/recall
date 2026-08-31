<script setup lang="ts">
// Loss quality — buckets the narrowed set's defeats into close /
// normal / stomp from the final score's margin (see
// match-loss-quality for the mode-agnostic rule). Uniquely
// actionable for a competitive player: a stomp streak says stop
// queuing, close losses say keep going. Opt-in.
import { computed } from 'vue'
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const breakdown = dossier.lossQualityBreakdown()

// The kernel always returns all three buckets, so "nothing was lost" arrives
// as three zeroes rather than as an empty list. Printing them reads as a
// measurement — blank is not zero. Unscored losses are still losses, so they
// keep the buckets on screen and speak for themselves below.
const noDefeats = computed(() =>
  breakdown.value.unscored === 0 && breakdown.value.rows.every((r) => r.total === 0))
</script>

<template>
  <header class="breakdown-head">
    <span class="eyebrow accent breakdown-eyebrow">Loss quality</span>
  </header>
  <p v-if="noDefeats" class="lq-unscored">
    No defeats in this set.
  </p>
  <ul v-else>
    <li v-for="row in breakdown.rows" :key="row.key" :data-loss-quality-row="row.key">
      <span class="bd-name lq-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span
          class="bd-fill"
          role="progressbar"
          :aria-valuenow="Math.round(row.share)"
          aria-valuemin="0"
          aria-valuemax="100"
          :aria-label="`${row.key} share`"
          :style="{ width: row.share + '%' }"
        />
        <span class="bd-time">{{ row.total }}x</span>
      </span>
      <span class="bd-stats">{{ row.share }}%</span>
    </li>
  </ul>
  <p v-if="breakdown.unscored > 0" class="lq-unscored">
    {{ breakdown.unscored }} loss{{ breakdown.unscored === 1 ? '' : 'es' }} without a readable score
  </p>
</template>

<style scoped>
.lq-name {
  text-transform: capitalize;
}

.lq-unscored {
  margin: 0.4rem 0 0;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
</style>

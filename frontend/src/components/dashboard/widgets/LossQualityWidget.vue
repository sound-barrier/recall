<script setup lang="ts">
// Loss quality — buckets the narrowed set's defeats into close /
// normal / stomp from the final score's margin (see
// match-loss-quality for the mode-agnostic rule). Uniquely
// actionable for a competitive player: a stomp streak says stop
// queueing, close losses say keep going. Opt-in.
import { useDossier } from '@/composables/dashboard/useDossier'

const dossier = useDossier()
const breakdown = dossier.lossQualityBreakdown()
</script>

<template>
  <header class="breakdown-head">
    <span class="breakdown-eyebrow">Loss quality</span>
  </header>
  <ul>
    <li v-for="row in breakdown.rows" :key="row.key" :data-loss-quality-row="row.key">
      <span class="bd-name lq-name">{{ row.key }}</span>
      <span class="bd-bar">
        <span class="bd-fill" :style="{ width: row.share + '%' }" />
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
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  color: var(--text-faint);
}
</style>

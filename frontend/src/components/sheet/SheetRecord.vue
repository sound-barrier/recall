<script setup lang="ts">
import type { WLDTally } from '@/match/match-stats-helpers'

// The record row on a sheet: won / lost / drew and the win rate. Written on
// paper — .score-num / .score-cell / .score-label are the masthead
// scoreboard's family and take the ink palette from the plate.
withDefaults(defineProps<{
  wld: WLDTally
  winRate: number | null
  /** The group's accessible name — whose record this is. */
  label?: string
}>(), { label: 'Session record' })
</script>

<template>
  <div class="sheet-record" role="group" :aria-label="label">
    <div class="score-cell">
      <span class="score-num win">{{ wld.w }}</span>
      <span class="score-label">Won</span>
    </div>
    <div class="score-cell">
      <span class="score-num loss">{{ wld.l }}</span>
      <span class="score-label">Lost</span>
    </div>
    <div class="score-cell">
      <span class="score-num draw">{{ wld.d }}</span>
      <span class="score-label">Drew</span>
    </div>
    <p class="sheet-rate">
      <span class="sheet-rate-num">{{ winRate === null ? '—' : `${winRate}%` }}</span>
      <span class="score-label">Win rate</span>
    </p>
  </div>
</template>

<style scoped>
.sheet-record {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.9rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--paper-rule);
  border-bottom: 1px solid var(--paper-rule);
}

.sheet-rate {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  margin: 0 0 0 auto;
}

.sheet-rate-num {
  font-family: var(--mono);
  font-size: var(--type-4xl);
  font-weight: 700;
  color: var(--ink);
  font-feature-settings: "tnum";
}
</style>

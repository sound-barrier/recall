<script setup lang="ts">
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// The Time-scope facet: preset range chips (All / 7d / 30d / 90d) + a custom
// from/to date pair. Reads + writes pickedRange / customFrom / customTo off the
// shared narrow bundle — picking a preset clears the custom dates; editing either
// date flips pickedRange to 'custom'. np-section / np-chip chrome is global
// (narrow.css); the date inputs carry their own scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { pickedRange, customFrom, customTo, pickRange } = props.narrow
</script>

<template>
  <!-- Time scope — preset + custom dates side-by-side. -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">Time scope</span>
      <span class="np-section-meta">
        <template v-if="customFrom || customTo">{{ customFrom || '…' }} → {{ customTo || '…' }}</template>
        <template v-else-if="pickedRange !== 'all'">last {{ pickedRange }}</template>
        <template v-else>all time</template>
      </span>
    </div>
    <div class="np-chips">
      <button
        v-for="opt in (['all', '7d', '30d', '90d'] as const)"
        :key="opt"
        class="np-chip"
        :class="{ picked: pickedRange === opt && !customFrom && !customTo }"
        @click="pickRange(opt)"
      >
        {{ opt === 'all' ? 'All time' : `Last ${opt}` }}
      </button>
    </div>
    <div class="np-daterange">
      <label class="np-date-label">
        <span>From</span>
        <input
          type="date"
          class="np-date"
          :value="customFrom"
          @input="customFrom = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
        >
      </label>
      <label class="np-date-label">
        <span>To</span>
        <input
          type="date"
          class="np-date"
          :value="customTo"
          @input="customTo = ($event.target as HTMLInputElement).value; pickedRange = 'custom'"
        >
      </label>
      <button
        v-if="customFrom || customTo"
        class="np-date-clear"
        @click="customFrom = ''; customTo = ''; pickedRange = 'all'"
      >
        Clear dates
      </button>
    </div>
  </section>
</template>

<style scoped>
.np-daterange {
  display: flex;
  gap: 0.4rem;
  align-items: end;
  flex-wrap: wrap;
}

.np-date-label {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-date {
  appearance: none;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.4rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text);
  outline: 0;
  color-scheme: dark light;
}

.np-date:focus { border-color: var(--accent); }

.np-date-clear {
  appearance: none;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.25rem 0.5rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-dim);
  cursor: pointer;
}

.np-date-clear:hover { color: var(--accent); border-color: var(--accent); }
</style>

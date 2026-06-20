<script setup lang="ts">
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'

// Refinement facet: the per-hero min-play thresholds (minutes OR percent that a
// picked hero must meet in a match's heroes-played row) plus the include-unknown-
// map toggle. Reads + writes minPlayMinutes / minPlayPercent / includeUnknown off
// the shared narrow bundle. Chrome is global (narrow.css); no scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { minPlayMinutes, minPlayPercent, includeUnknown } = props.narrow
</script>

<template>
  <!-- Min play threshold (both minutes + percent; OR semantics) + unknown toggle -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">Refinement</span>
      <span class="np-section-meta">applies to picked heroes</span>
    </div>
    <div class="np-refine-row">
      <p class="np-refine-hint">
        Picked hero must meet at least one threshold in a match's heroes-played row.
      </p>
      <div class="np-thresholds">
        <label class="np-num-label">
          <span>Min play time</span>
          <div class="np-num-input">
            <input
              type="number"
              min="0"
              step="1"
              class="np-num"
              :value="minPlayMinutes"
              @input="minPlayMinutes = parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0"
            >
            <span class="np-num-unit">min</span>
          </div>
        </label>
        <span class="np-thresholds-or">or</span>
        <label class="np-num-label">
          <span>Min played %</span>
          <div class="np-num-input">
            <input
              type="number"
              min="0"
              max="100"
              step="5"
              class="np-num"
              :value="minPlayPercent"
              @input="minPlayPercent = Math.max(0, Math.min(100, parseInt(($event.target as HTMLInputElement).value || '0', 10) || 0))"
            >
            <span class="np-num-unit">%</span>
          </div>
        </label>
      </div>
      <label class="np-toggle-label">
        <input
          type="checkbox"
          :checked="includeUnknown"
          @change="includeUnknown = ($event.target as HTMLInputElement).checked"
        >
        <span>Show unknown-map matches</span>
      </label>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useWindowMonths } from '@/composables/matches/useWindowMonths'
import MatchHeatmapHeader from '@/components/matches/timeline/MatchHeatmapHeader.vue'
import MatchSparklineBrush from '@/components/matches/timeline/MatchSparklineBrush.vue'

// CAMPAIGN LOG — the temporal header for the Matches view.
//
// Two visualisations side-by-side, sharing one trailing-N-months
// window:
//   - Calendar heatmap (left) — 7×N grid; win-rate hue × volume
//     saturation. Click a cell to set a single-day filter.
//   - Brushable bar sparkline (right) — one bar per day, height ∝
//     volume, hue ∝ W%. Drag across bars to set a date range; click
//     without drag clears.
//
// Both reach the same `customFrom` / `customTo` refs on the narrow
// filter state (wired in MatchesView's template) so flipping one
// updates the other's selection band.

defineProps<{
  records: MatchRecord[]
  filterFrom: string
  filterTo: string
  weekStartsOn?: 0 | 1
}>()

const emit = defineEmits<{
  'update:filter-from': [value: string]
  'update:filter-to':   [value: string]
}>()

const { windowMonths, pickWindow } = useWindowMonths('recall.timelineWindowMonths')

const windowWeeks = computed((): number => {
  switch (windowMonths.value) {
    case 1:  return 5
    case 3:  return 13
    case 6:  return 26
    case 12: return 52
    default: return 26
  }
})

const windowLabel = computed(() => `Last ${windowMonths.value} month${windowMonths.value === 1 ? '' : 's'}`)
</script>

<template>
  <section
    class="match-timeline"
    aria-labelledby="timeline-eyebrow"
  >
    <header class="timeline-head">
      <span id="timeline-eyebrow" class="timeline-eyebrow">Campaign Log</span>
      <span class="timeline-range">{{ windowLabel }}</span>

      <div class="timeline-window" role="group" aria-label="Heatmap window">
        <button
          v-for="m in ([1, 3, 6, 12] as const)"
          :key="m"
          type="button"
          class="window-btn"
          :class="{ active: windowMonths === m }"
          :aria-pressed="windowMonths === m"
          :title="`Show last ${m} months`"
          @click="pickWindow(m)"
        >
          {{ m }}M
        </button>
      </div>

      <ul class="timeline-legend" aria-label="Cell-color legend">
        <li><span class="legend-swatch legend-loss" /> Losing</li>
        <li><span class="legend-swatch legend-mixed" /> Mixed</li>
        <li><span class="legend-swatch legend-win" /> Winning</li>
      </ul>
    </header>

    <div class="timeline-body">
      <p v-if="records.length === 0" class="timeline-empty" data-timeline-no-data>
        At least 1 match must be played to display data.
      </p>
      <template v-else>
        <MatchHeatmapHeader
          :records="records"
          :filter-from="filterFrom"
          :filter-to="filterTo"
          :window-weeks="windowWeeks"
          :week-starts-on="weekStartsOn"
          @update:filter-from="(v: string) => emit('update:filter-from', v)"
          @update:filter-to="(v: string) => emit('update:filter-to', v)"
        />
        <MatchSparklineBrush
          :records="records"
          :filter-from="filterFrom"
          :filter-to="filterTo"
          :window-weeks="windowWeeks"
          :week-starts-on="weekStartsOn"
          @update:filter-from="(v: string) => emit('update:filter-from', v)"
          @update:filter-to="(v: string) => emit('update:filter-to', v)"
        />
      </template>
    </div>
  </section>
</template>

<style scoped>
.match-timeline {
  padding: 0.7rem 1.1rem 0.65rem;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, transparent) 0%, transparent 40%),
    var(--surface);
  border-radius: 2px;
}

.timeline-empty {
  margin: 0.4rem 0;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
}

.timeline-head {
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  margin-bottom: 0.55rem;
  flex-wrap: wrap;
}

.timeline-eyebrow {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent);
  font-weight: 700;
}

.timeline-range {
  font-family: var(--mono);
  font-size: 0.65rem;
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.timeline-window {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.window-btn {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  font-weight: 600;
  padding: 0.22rem 0.55rem;
  cursor: pointer;
  border-right: 1px solid var(--border);
  transition: color 140ms ease, background 140ms ease;
}
.window-btn:last-child { border-right: 0; }
.window-btn:hover      { color: var(--text); }

.window-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.window-btn.active {
  background: var(--accent);
  color: var(--primary-text-on-accent);
}

.timeline-legend {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  list-style: none;
  margin: 0 0 0 0.6rem;
  padding: 0;
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.timeline-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.legend-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
}
.legend-win   { background: var(--win); }
.legend-loss  { background: var(--loss); }
.legend-mixed { background: color-mix(in srgb, var(--win) 50%, var(--loss)); }

.timeline-body {
  display: flex;
  align-items: flex-start;
  gap: 1.2rem;
  overflow: auto hidden;
}

@media (width <= 720px) {
  .timeline-legend { display: none; }

  .timeline-body {
    flex-direction: column;
    gap: 0.8rem;
  }
}
</style>

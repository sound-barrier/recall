<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
import { bumpTally, newTally } from '@/match/dossier/match-dossier-tally'
import { useWindowMonths } from '@/composables/matches/dossier/useWindowMonths'
import BandHeaderControls from '@/components/matches/dossier/BandHeaderControls.vue'
import MatchHeatmapHeader from '@/components/matches/timeline/MatchHeatmapHeader.vue'
import MatchSparklineBrush from '@/components/matches/timeline/MatchSparklineBrush.vue'

// CAMPAIGN LOG — the temporal header for the Matches view.
//
// Two visualizations side-by-side, sharing one trailing-N-months
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

const props = defineProps<{
  records: MatchRecord[]
  filterFrom: string
  filterTo: string
  // Picked-season day span (YYYY-MM-DD), '' when none — a passive highlight on
  // the calendar + sparkline so a season pick echoes on the Campaign Log.
  seasonFrom?: string
  seasonTo?: string
  weekStartsOn?: 0 | 1
}>()

const emit = defineEmits<{
  'update:filter-from': [value: string]
  'update:filter-to':   [value: string]
}>()

// A header Reset so the date filter can be cleared without scrolling to the
// active-chips rail. Clicking an empty heatmap cell already does the same.
const dateFilterActive = computed(() => !!props.filterFrom || !!props.filterTo)
function resetRange() {
  emit('update:filter-from', '')
  emit('update:filter-to', '')
}

// Day-granular inclusive range check; an empty bound passes everything.
function dateInRange(d: string | undefined, from: string, to: string): d is string {
  return !!d && !(from && d < from) && !(to && d > to)
}

// Combined readout over the selected date range — mirrors the Geography band's
// "N cells · W–L–D · X% WR · N games", with days as the unit (heatmap cells are
// days). null when no range is active (the slot shows a prompt instead).
const selectionStats = computed(() => {
  if (!dateFilterActive.value) return null
  const from = props.filterFrom.slice(0, 10)
  const to = props.filterTo.slice(0, 10)
  const days = new Set<string>()
  const tally = newTally()
  for (const r of props.records) {
    const d = r.data?.date
    if (!dateInRange(d, from, to)) continue
    days.add(d)
    bumpTally(tally, r.data?.result)
  }
  const decided = tally.w + tally.l
  return {
    days: days.size, wins: tally.w, losses: tally.l, draws: tally.d, total: tally.total,
    winrate: decided ? Math.round((tally.w / decided) * 100) : null,
  }
})

const { WINDOW_MONTHS, windowMonths, pickWindow } = useWindowMonths('recall.timelineWindowMonths')

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
      <span id="timeline-eyebrow" class="eyebrow accent timeline-eyebrow">Campaign Log</span>
      <span class="timeline-range">{{ windowLabel }}</span>

      <BandHeaderControls
        :windows="WINDOW_MONTHS"
        :window-months="windowMonths"
        window-group-label="Heatmap window"
        legend="ramp"
        :reset="dateFilterActive
          ? { title: 'Clear the date filter', attrs: { 'data-timeline-reset': '' } }
          : null"
        @pick-window="pickWindow"
        @reset="resetRange"
      />
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
          :season-from="seasonFrom"
          :season-to="seasonTo"
          :window-weeks="windowWeeks"
          :week-starts-on="weekStartsOn"
          @update:filter-from="(v: string) => emit('update:filter-from', v)"
          @update:filter-to="(v: string) => emit('update:filter-to', v)"
        />
        <MatchSparklineBrush
          :records="records"
          :filter-from="filterFrom"
          :filter-to="filterTo"
          :season-from="seasonFrom"
          :season-to="seasonTo"
          :window-weeks="windowWeeks"
          :week-starts-on="weekStartsOn"
          @update:filter-from="(v: string) => emit('update:filter-from', v)"
          @update:filter-to="(v: string) => emit('update:filter-to', v)"
        />
      </template>
    </div>

    <!-- Combined readout for the selected range — consistent with the Geography
         band. The slot is always present (active stats or a faint prompt) so
         selecting a range never shifts the match list below. -->
    <div v-if="selectionStats" class="tl-selection" data-timeline-selection-bar>
      <span class="tl-sel-stats" data-timeline-selection-stats>
        <strong>{{ selectionStats.days }}</strong> day{{ selectionStats.days === 1 ? '' : 's' }}
        <span aria-hidden="true">·</span>
        {{ selectionStats.wins }}–{{ selectionStats.losses }}–{{ selectionStats.draws }}
        <template v-if="selectionStats.winrate !== null"> · {{ selectionStats.winrate }}% WR</template>
        · {{ selectionStats.total }} game{{ selectionStats.total === 1 ? '' : 's' }}
      </span>
    </div>
    <p
      v-else-if="records.length > 0"
      class="tl-selection tl-selection-empty"
      data-timeline-selection-empty
    >
      Click a day, drag a range, or pick a month to compare combined stats
    </p>
  </section>
</template>

<style scoped>
.match-timeline {
  padding: 0.7rem 1.1rem 0.65rem;
  border: 1px solid var(--border);
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--accent) 4%, transparent) 0%, transparent 40%),
    var(--surface);
  border-radius: var(--radius);
}

.timeline-empty {
  margin: 0.4rem 0;
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-faint);
}

.timeline-head {
  display: flex;
  align-items: baseline;
  gap: 1.1rem;
  margin-bottom: 0.55rem;
  flex-wrap: wrap;
}

.timeline-range {
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.04em;
  color: var(--text-faint);
}

.timeline-body {
  display: flex;
  align-items: flex-start;
  gap: 1.2rem;
  overflow: auto hidden;
}

@media (width <= 720px) {
  .timeline-body {
    flex-direction: column;
    gap: 0.8rem;
  }
}

/* Combined readout — visually consistent with the Geography band's bar. The slot
   is reserved (active stats or a faint prompt) so selecting never shifts the
   match list below. */
.tl-selection {
  display: flex;
  align-items: center;
  gap: 0.5rem 0.9rem;
  margin: 0.6rem 0 0;
  min-height: 2.1rem;
  box-sizing: border-box;
  padding: 0.4rem 0.55rem;
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border));
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.tl-selection-empty {
  justify-content: center;
  border-style: dashed;
  border-color: var(--border);
  background: transparent;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.03em;
  font-style: italic;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-sel-stats {
  font-family: var(--mono);
  font-size: var(--type-sm);
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tl-sel-stats strong { color: var(--accent-text); font-weight: 700; }
</style>

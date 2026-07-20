<script setup lang="ts">
import type { useMatchesNarrow } from '@/composables/matches/useMatchesNarrow'
import { formatRangeBound } from '@/match/match-time-helpers'
import { useOWData } from '@/composables/shared/useOWData'

// The Time-scope facet: preset range chips (All / 7d / 30d / 90d) + a custom
// from/to date pair, each with an OPTIONAL minute bound (blank = whole day —
// the patch-drop primitive: "from Jan 7 11:00" splits a day at the patch).
// Reads + writes pickedRange / customFrom / customTo (+ the panel-owned
// customFromTime / customToTime) off the shared narrow bundle — picking a
// preset clears the custom dates and times; editing either date flips
// pickedRange to 'custom'; emptying a date clears its time (a time without
// a date is inert, so the input is disabled until its date is set).
// np-section / np-chip chrome is global (narrow.css); the date/time inputs
// carry their own scoped styles.
type MatchesNarrowApi = ReturnType<typeof useMatchesNarrow>
const props = defineProps<{ narrow: MatchesNarrowApi }>()
const { pickedRange, customFrom, customTo, customFromTime, customToTime, pickRange, pickedSeason } = props.narrow

// Season options come from reference data (seasons.yaml), grouped by chapter
// for the <optgroup>s. A season assigns a match by its START time and ANDs
// with the date range, so it sits above the preset chips as the coarsest scope.
// '' = "Any season" (the empty option), which clears the filter.
const { seasonsByChapter } = useOWData()

function onSeasonChange(e: Event) {
  pickedSeason.value = (e.target as HTMLSelectElement).value
}

function onDateInput(side: 'from' | 'to', value: string) {
  const dateRef = side === 'from' ? customFrom : customTo
  const timeRef = side === 'from' ? customFromTime : customToTime
  dateRef.value = value
  if (!value) timeRef.value = ''
  pickedRange.value = 'custom'
}

function onTimeInput(side: 'from' | 'to', value: string) {
  const timeRef = side === 'from' ? customFromTime : customToTime
  timeRef.value = value
  pickedRange.value = 'custom'
}

function clearDates() {
  customFrom.value = ''
  customTo.value = ''
  customFromTime.value = ''
  customToTime.value = ''
  pickedRange.value = 'all'
}
</script>

<template>
  <!-- Time scope — preset + custom dates side-by-side. -->
  <section class="np-section">
    <div class="np-section-head">
      <span class="np-section-eyebrow">Time scope</span>
      <span class="np-section-meta">
        <template v-if="customFrom || customTo">{{ formatRangeBound(customFrom, customFromTime) }} → {{ formatRangeBound(customTo, customToTime) }}</template>
        <template v-else-if="pickedRange !== 'all'">last {{ pickedRange }}</template>
        <template v-else>all time</template>
      </span>
    </div>
    <label v-if="seasonsByChapter.length" class="np-season">
      <span class="np-season-label">Season</span>
      <select
        class="np-date np-season-select"
        data-np-season
        :value="pickedSeason"
        @change="onSeasonChange"
      >
        <option value="">Any season</option>
        <optgroup v-for="group in seasonsByChapter" :key="group.chapter" :label="group.chapter">
          <option v-for="s in group.seasons" :key="s.name" :value="s.name">{{ s.name }}</option>
        </optgroup>
      </select>
    </label>
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
          data-np-from-date
          :value="customFrom.slice(0, 10)"
          @input="onDateInput('from', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>From time</span>
        <input
          type="time"
          class="np-date np-time"
          data-np-from-time
          :value="customFromTime"
          :disabled="!customFrom"
          title="Optional — narrow the From day to a start time (e.g. a patch drop)"
          @input="onTimeInput('from', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>To</span>
        <input
          type="date"
          class="np-date"
          data-np-to-date
          :value="customTo.slice(0, 10)"
          @input="onDateInput('to', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <label class="np-date-label">
        <span>To time</span>
        <input
          type="time"
          class="np-date np-time"
          data-np-to-time
          :value="customToTime"
          :disabled="!customTo"
          title="Optional — cap the To day at an end time (inclusive minute)"
          @input="onTimeInput('to', ($event.target as HTMLInputElement).value)"
        >
      </label>
      <button
        v-if="customFrom || customTo"
        class="np-date-clear"
        @click="clearDates"
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

.np-season {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.5rem;
}

.np-season-label {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.np-season-select {
  flex: 1;
  min-width: 0;
}

.np-time {
  min-width: 5.4rem;
}

.np-time:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

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

.np-date-clear:hover { color: var(--accent-text); border-color: var(--accent); }
</style>

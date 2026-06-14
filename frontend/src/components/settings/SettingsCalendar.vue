<script setup lang="ts">
import { computed } from 'vue'
import type { WeekStart } from '@/match/match-time-helpers'
import { WEEKDAYS_FULL } from '@/match/match-time-helpers'

// Calendar panel of the Settings view — the first-day-of-week
// preference that anchors the "Week of …" headers on the Matches
// page.
//
// Extracted from SettingsView so the seven-cell segmented control +
// the caption + the day-name lookup stay scoped to the section that
// owns them.

const props = defineProps<{
  weekStart: WeekStart
}>()

const emit = defineEmits<{
  'set-week-start': [next: WeekStart]
  'go-to-view': [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()

// The seven first-day-of-week options. Order = JS Date.getDay() so
// the index IS the WeekStart value — no separate mapping needed.
// Letter is the visual marker for the segmented control; the full
// day name sits in the caption below so ambiguity (two Ts, two Ss)
// is always resolved by the label.
const DAY_SEGMENTS = WEEKDAYS_FULL.map((name, idx) => ({
  idx: idx as WeekStart,
  letter: name.charAt(0),
  name,
}))

const activeWeekDayName = computed(() => WEEKDAYS_FULL[props.weekStart] ?? 'Sunday')
</script>

<template>
  <div id="sec-calendar" class="settings-section">
    <div class="section-header">
      <span class="section-num">04</span>
      <span class="section-slash" aria-hidden="true">/</span>
      <h3 class="section-title">
        Calendar
      </h3>
    </div>
    <div class="setting-rows">
      <div class="setting-row">
        <div class="setting-info">
          <h4 class="setting-label">
            First Day of Week
            <span class="setting-help" tabindex="0" role="note">
              <span class="setting-help-mark" aria-hidden="true">?</span>
              <span class="setting-help-label">About First Day of Week</span>
              <span class="setting-help-pop" role="tooltip">
                Sets where weeks begin in date grouping. Sunday-anchored in the US/CA, Monday-anchored across most of Europe and ISO calendars.
              </span>
            </span>
          </h4>
          <p class="setting-desc">
            Anchors the
            <button type="button" class="empty-link" @click="emit('go-to-view', 'matches')">
              Week of
            </button>
            headers on the Matches page.
          </p>
        </div>
        <div class="setting-control weekstart-control">
          <div
            class="weekstart-grid"
            role="radiogroup"
            aria-label="First day of week"
          >
            <button
              v-for="seg in DAY_SEGMENTS"
              :key="seg.idx"
              type="button"
              class="weekstart-cell"
              role="radio"
              :aria-checked="weekStart === seg.idx"
              :class="{ active: weekStart === seg.idx }"
              :title="`Weeks begin on ${seg.name}`"
              @click="emit('set-week-start', seg.idx)"
            >
              <span class="weekstart-letter" aria-hidden="true">{{ seg.letter }}</span>
            </button>
          </div>
          <p class="weekstart-caption">
            Weeks begin on <strong>{{ activeWeekDayName }}</strong>.
          </p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Replaces the old ~490 px segmented row. Seven 36 px cells
   shoulder-to-shoulder, each carrying a single Big Noodle initial. */
.weekstart-control {
  display: inline-flex;
  flex-direction: column;
  gap: 0.4rem;
}

.weekstart-grid {
  display: inline-grid;
  grid-template-columns: repeat(7, 38px);
  background: var(--surface-2);
  border: 1px solid var(--border-soft);
  border-radius: 2px;
  padding: 2px;
  transition: border-color 140ms ease;
}

.weekstart-grid:hover {
  border-color: var(--border-strong);
}

.weekstart-grid:focus-within {
  border-color: var(--accent);
}

.weekstart-cell {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 38px;
  background: transparent;
  border: 0;
  border-radius: 1px;
  color: var(--text-faint);
  cursor: pointer;
  transition: color 140ms ease, background 140ms ease, box-shadow 140ms ease, transform 140ms ease;
}

.weekstart-cell:hover {
  color: var(--text);
  background: rgb(255 255 255 / 3%);
}

.weekstart-cell.active {
  color: var(--accent);
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.weekstart-letter {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', sans-serif;
  font-style: italic;
  font-size: 1.05rem;
  letter-spacing: 0.05em;
  line-height: 1;
}

.weekstart-caption {
  margin: 0;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.weekstart-caption strong {
  color: var(--text);
  font-weight: 700;
}
</style>

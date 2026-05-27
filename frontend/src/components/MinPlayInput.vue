<script setup lang="ts">
import { computed } from 'vue'

// Minimum-play threshold input — percent on the left, m + s on the
// right, with an "or" divider. Either side > 0 tints the group with
// the accent. Mutual exclusion is enforced by `disabled` on the
// inactive half — caller must zero one out before engaging the other.
//
// Extracted from FilterRail so the m/s decomposition + the
// percent-vs-time mutex stay testable in isolation.

const props = defineProps<{
  minPlayPercent: number
  minPlayMinutes: number
}>()

const emit = defineEmits<{
  'set-min-play-percent': [n: number]
  'set-min-play-minutes': [n: number]
}>()

function readNumberInput(e: Event): number {
  const v = (e.target as HTMLInputElement).valueAsNumber
  return Number.isFinite(v) ? v : 0
}

// minPlayMinutes is persisted as a single fractional-minutes value.
// Split into whole minutes + remainder seconds so the user can type
// "0m 30s" instead of "0.5". Rounded to the nearest second.
const minutesWhole = computed(() => Math.floor(props.minPlayMinutes))
const secondsWhole = computed(() => Math.round((props.minPlayMinutes - minutesWhole.value) * 60))

// Seconds outside [0, 59] roll into minutes (90s → +1m 30s) so the
// user typing past 59 doesn't lose precision.
function emitMinutesFromMS(newM: number, newS: number) {
  const m = Math.max(0, Number.isFinite(newM) ? Math.floor(newM) : 0)
  const s = Math.max(0, Number.isFinite(newS) ? newS : 0)
  emit('set-min-play-minutes', m + s / 60)
}

function onMinutesChange(e: Event) {
  emitMinutesFromMS(readNumberInput(e), secondsWhole.value)
}

function onSecondsChange(e: Event) {
  emitMinutesFromMS(minutesWhole.value, readNumberInput(e))
}

// Mutual exclusion: the user picks ONE threshold. The active knob
// disables the inactive half until the user clears it back to 0.
const percentDisabled = computed(() => props.minPlayMinutes > 0)
const timeDisabled    = computed(() => props.minPlayPercent > 0)
</script>

<template>
  <div
    class="min-play-group"
    :class="{ active: minPlayPercent > 0 || minPlayMinutes > 0 }"
    role="group"
    aria-label="Minimum play threshold"
  >
    <span class="min-play-eyebrow">Min play</span>
    <label class="min-play-cell" :class="{ disabled: percentDisabled }">
      <input
        type="number"
        inputmode="numeric"
        min="0"
        max="100"
        step="1"
        class="min-play-input"
        :value="minPlayPercent || ''"
        placeholder="0"
        :disabled="percentDisabled"
        aria-label="Minimum percent of match played"
        :title="percentDisabled
          ? 'Clear the minutes/seconds back to 0 to switch to a percent threshold.'
          : 'Hide matches where the selected hero played less than this share of the match. 0 = off.'"
        @change="emit('set-min-play-percent', readNumberInput($event))"
      >
      <span class="min-play-unit">%</span>
    </label>
    <span class="min-play-or" aria-hidden="true">or</span>
    <label class="min-play-cell min-play-time" :class="{ disabled: timeDisabled }">
      <input
        type="number"
        inputmode="numeric"
        min="0"
        max="240"
        step="1"
        class="min-play-input min-play-input-min"
        :value="minutesWhole || ''"
        placeholder="0"
        :disabled="timeDisabled"
        aria-label="Minimum minutes played"
        :title="timeDisabled
          ? 'Clear the percent back to 0 to switch to a time threshold.'
          : 'Minutes component of the minimum play time. Combines with the seconds box on the right.'"
        @change="onMinutesChange($event)"
      >
      <span class="min-play-unit">m</span>
      <input
        type="number"
        inputmode="numeric"
        min="0"
        max="59"
        step="1"
        class="min-play-input min-play-input-sec"
        :value="secondsWhole || ''"
        placeholder="0"
        :disabled="timeDisabled"
        aria-label="Minimum seconds played"
        :title="timeDisabled
          ? 'Clear the percent back to 0 to switch to a time threshold.'
          : 'Seconds component of the minimum play time. 90s rolls over into minutes.'"
        @change="onSecondsChange($event)"
      >
      <span class="min-play-unit">s</span>
    </label>
  </div>
</template>

<style scoped>
/* Min-play threshold — two narrow number inputs sharing one eyebrow
   label, ghost styling so they read as ambient knobs in the filter
   tools row. When either input is non-zero (`.active`), the whole
   group tints with the brand accent the same way `.undated-toggle
   .active` does, so the user can scan the row and immediately spot
   every engaged filter. */

.min-play-group {
  display: inline-flex;
  align-items: center;
  gap: 0.42rem;
  padding: 0.2rem 0.5rem 0.2rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: transparent;
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-faint);
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.min-play-group:hover {
  border-color: var(--border-strong);
}

.min-play-group.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}

.min-play-eyebrow {
  font-weight: 700;
  white-space: nowrap;
}

.min-play-cell {
  display: inline-flex;
  align-items: baseline;
  gap: 0.15rem;
  transition: opacity 140ms ease;
}

.min-play-cell.disabled {
  opacity: 0.42;
  cursor: not-allowed;
}

/* The time cell carries the minutes box, "m" label, seconds box, "s"
   label — tighter gap between the m/s pair than between cells. */
.min-play-time {
  gap: 0.1rem;
}

.min-play-time .min-play-unit + .min-play-input {
  margin-left: 0.2rem;
}

.min-play-input-min,
.min-play-input-sec {
  width: 2rem;
}

.min-play-input {
  width: 2.4rem;
  padding: 0.05rem 0.15rem;
  background: var(--surface-2, transparent);
  border: 1px solid var(--border);
  border-radius: 1px;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  appearance: textfield;
}

.min-play-input::-webkit-inner-spin-button,
.min-play-input::-webkit-outer-spin-button {
  appearance: none;
  margin: 0;
}

.min-play-input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent-soft);
}

.min-play-input:disabled {
  cursor: not-allowed;
  background: transparent;
  border-style: dashed;
  color: var(--text-faint);
}

.min-play-group.active .min-play-input {
  border-color: var(--accent);
}

.min-play-unit {
  font-weight: 600;
  opacity: 0.7;
}

.min-play-or {
  font-style: italic;
  text-transform: lowercase;

  /* Used to dim via `opacity: 0.55` on the inherited --text-faint, but
     compositing pushed the effective foreground to #53555e on --surface
     (2.46:1, fails WCAG AA). Use --text-mute directly so the colour
     stays muted while clearing 4.5:1 on every surface. */
  color: var(--text-mute);
}
</style>

<script setup lang="ts">
import type { WindowMonths } from '@/composables/matches/useWindowMonths'
import { JUDGMENT_LABEL } from '@/match/match-heatmap-helpers'

// Shared header furniture for the three dossier bands (Campaign Log
// timeline, Geography map × role, Hero × Game-Mode): the time-window
// picker, the optional filter-reset button, the optional config gear with
// its active-filter dot, and the cell-color legend. Extracted on the
// third occurrence per the DRY rule of three — the markup and CSS were
// triplicated byte-for-byte modulo class prefixes.
//
// TWO legends, because the bands below are two different kinds of
// picture. `bands` describes the discrete verdict palette the Geography
// and Hero × Game-Mode grids paint — its swatches wear the very
// .cell-* classes those grids do and its words come straight from
// JUDGMENT_LABEL, so a legend can no longer describe a color the cells
// do not use or a word they do not speak. `ramp` describes the Campaign
// Log's calendar, which RECORDS each day on a continuous hue with no
// thresholds and no evidence floor; three discrete verdicts over that
// picture claimed a judgment the calendar never made (a single 1-0 day
// paints full green, where the shared engine would say
// "too few games to judge").
//
// Reset and gear arrive as nullable bundles rather than boolean+label
// props so each band's conditional rendering (`filterActive`, root-depth
// gating) collapses into one expression at the call site. The per-band
// e2e hooks (data-mr-reset, data-timeline-reset, …) ride in via each
// bundle's `attrs` so existing spec selectors keep working.

interface BandResetControl {
  title: string
  attrs?: Record<string, string>
}

interface BandGearControl {
  active: boolean
  ariaLabel: string
  title: string
  expanded: boolean
  attrs?: Record<string, string>
}

withDefaults(defineProps<{
  windows: readonly WindowMonths[]
  windowMonths: WindowMonths
  windowGroupLabel?: string
  reset?: BandResetControl | null
  gear?: BandGearControl | null
  legend?: 'bands' | 'ramp' | 'none'
}>(), {
  windowGroupLabel: 'Time window',
  reset: null,
  gear: null,
  legend: 'bands',
})

// One name for the whole strip, on one role="img" node, so a screen
// reader hears a single scale — not three verdicts the calendar is not
// entitled to. Deliberately free of the JUDGMENT_LABEL vocabulary: this
// picture has no bands to speak.
const RAMP_LABEL = 'Calendar color scale: a day\'s win rate ramps continuously from 0% at the left '
  + 'to 100% at the right, deepening with the number of games played that day. '
  + 'Each day is recorded, not judged against a threshold.'

const emit = defineEmits<{
  'pick-window': [months: WindowMonths]
  reset: []
  // Carries the click event: both gear consumers anchor their config
  // popover at the gear's bounding rect via e.currentTarget.
  'toggle-config': [e: MouseEvent]
}>()
</script>

<template>
  <div class="bh-window" role="group" :aria-label="windowGroupLabel">
    <button
      v-for="m in windows"
      :key="m"
      type="button"
      class="bh-window-btn"
      :class="{ active: windowMonths === m }"
      :aria-pressed="windowMonths === m"
      :title="`Last ${m} month${m === 1 ? '' : 's'}`"
      @click="emit('pick-window', m)"
    >
      {{ m }}M
    </button>
  </div>

  <button
    v-if="reset"
    type="button"
    class="bh-reset"
    v-bind="reset.attrs"
    :title="reset.title"
    @click="emit('reset')"
  >
    ⟲ Reset
  </button>

  <button
    v-if="gear"
    type="button"
    class="bh-gear"
    :class="{ 'bh-gear-active': gear.active }"
    v-bind="gear.attrs"
    :aria-label="gear.ariaLabel"
    :aria-expanded="gear.expanded"
    :title="gear.title"
    @click="emit('toggle-config', $event)"
  >
    <span aria-hidden="true">⚙</span>
  </button>

  <ul v-if="legend === 'bands'" class="bh-legend" aria-label="Cell-color legend">
    <li><span class="bh-swatch cell-loss" /> {{ JUDGMENT_LABEL.loss }}</li>
    <!-- One gray, two meanings: the eye cannot tell a level record from an
         unproven one, so the swatch says both and only the spoken half
         carries the second. -->
    <li>
      <span class="bh-swatch cell-mid" /> {{ JUDGMENT_LABEL.even }}<span class="sr-only"> or {{ JUDGMENT_LABEL.unproven }}</span>
    </li>
    <li><span class="bh-swatch cell-win" /> {{ JUDGMENT_LABEL.win }}</li>
  </ul>

  <div v-else-if="legend === 'ramp'" class="bh-ramp" role="img" :aria-label="RAMP_LABEL">
    <span class="bh-ramp-cap">0%</span>
    <span class="bh-ramp-bar" />
    <span class="bh-ramp-cap">100%</span>
  </div>
</template>

<style scoped>
.bh-window {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
}

.bh-window-btn {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  font-weight: 600;
  padding: 0.22rem 0.55rem;
  cursor: pointer;
  border-right: 1px solid var(--border);
  transition: color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.bh-window-btn:last-child { border-right: 0; }
.bh-window-btn:hover { color: var(--text); }

.bh-window-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.bh-window-btn.active {
  background: var(--accent);
  color: var(--primary-text-on-accent);
}

/* Reset — clears the band's filter without a scroll to the chips rail. */
.bh-reset {
  appearance: none;
  margin-left: 0.4rem;
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  background: transparent;
  color: var(--accent-text);
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.22rem 0.5rem;
  cursor: pointer;
  transition: background var(--duration-fast) ease, color var(--duration-fast) ease;
}

.bh-reset:hover { background: var(--accent); color: var(--primary-text-on-accent, var(--bg)); }
.bh-reset:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Gear — opens the band's display-filter popover. An accent dot in the
   corner signals when a filter is active. */
.bh-gear {
  position: relative;
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.5rem;
  height: 1.4rem;
  padding: 0;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface-2);
  color: var(--text-faint);
  font-size: var(--type-md);
  cursor: pointer;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

.bh-gear:hover { color: var(--accent-text); border-color: var(--accent); background: var(--accent-soft); }
.bh-gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.bh-gear-active {
  color: var(--accent-text);
  border-color: var(--accent);
}

.bh-gear-active::after {
  content: '';
  position: absolute;
  top: -3px;
  right: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 0 1.5px var(--surface);
}

.bh-legend {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  list-style: none;
  margin: 0 0 0 0.6rem;
  padding: 0;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.bh-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

/* Geometry only — the fill arrives with the .cell-* class the grids below
   wear, from styles/judgment.css. Declaring a background here would let the
   legend drift away from the cells again, which is exactly how "Mixed"
   ended up a red/green blend while the cells it labeled were gray. */
.bh-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
}

/* Ramp legend — the Campaign Log's continuous scale. */
.bh-ramp {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  margin-left: 0.6rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.bh-ramp-cap {
  white-space: nowrap;
}

/* Two stops interpolated in sRGB is exactly what the calendar's own
   `color-mix(in srgb, var(--win) <winrate>%, var(--loss))` computes, so the
   strip IS the ramp rather than a lookalike of it. */
.bh-ramp-bar {
  display: inline-block;
  width: 4.5rem;
  height: 10px;
  border-radius: var(--radius);
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
  background: linear-gradient(to right, var(--loss), var(--win));
}

@media (width <= 720px) {
  .bh-legend,
  .bh-ramp { display: none; }
}
</style>

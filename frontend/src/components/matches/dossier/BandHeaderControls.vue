<script setup lang="ts">
import type { WindowMonths } from '@/composables/matches/useWindowMonths'

// Shared header furniture for the three dossier bands (Campaign Log
// timeline, Geography map × role, Hero × Game-Mode): the time-window
// picker, the optional filter-reset button, the optional config gear with
// its active-filter dot, and the win/mixed/loss legend. Extracted on the
// third occurrence per the DRY rule of three — the markup and CSS were
// triplicated byte-for-byte modulo class prefixes.
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
  legend?: boolean
}>(), {
  windowGroupLabel: 'Time window',
  reset: null,
  gear: null,
  legend: true,
})

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

  <ul v-if="legend" class="bh-legend" aria-label="Cell-colour legend">
    <li><span class="bh-swatch bh-loss" /> Losing</li>
    <li><span class="bh-swatch bh-mixed" /> Mixed</li>
    <li><span class="bh-swatch bh-win" /> Winning</li>
  </ul>
</template>

<style scoped>
.bh-window {
  display: inline-flex;
  align-items: center;
  margin-left: auto;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
}

.bh-window-btn {
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
  border-radius: 2px;
  background: transparent;
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.6rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 0.22rem 0.5rem;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
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
  border-radius: 2px;
  background: var(--surface-2);
  color: var(--text-faint);
  font-size: 0.78rem;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.bh-gear:hover { color: var(--accent); border-color: var(--accent); background: var(--accent-soft); }
.bh-gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.bh-gear-active {
  color: var(--accent);
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
  font-size: 0.58rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.bh-legend li {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.bh-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  border: 1px solid color-mix(in srgb, currentcolor 25%, transparent);
}

.bh-win { background: var(--win); }
.bh-loss { background: var(--loss); }
.bh-mixed { background: color-mix(in srgb, var(--win) 50%, var(--loss)); }

@media (width <= 720px) {
  .bh-legend { display: none; }
}
</style>

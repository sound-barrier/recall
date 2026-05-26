<script setup lang="ts">
import { computed } from 'vue'
import { sshotTypeLabel } from '../match-helpers'
import { useOWData } from '../composables/useOWData'

// Canonical-name lookups for the hero + map filter pills. The OWData
// fetch is shared across every component that calls useOWData; this
// component pays no extra network cost. Until the fetch resolves the
// helpers return the stored lowercase form (graceful fall-back).
const ow = useOWData()

const props = defineProps<{
  modes: string[]
  maps: string[]
  types: string[]
  roles: string[]
  heroes: string[]
  results: string[]
  sshotTypes: string[]
  filterList: (field: string) => string[]
  filterSearch: Record<string, string>
  openFilter: string
  filterFrom: string
  filterTo: string
  sortDir: string
  undatedMatchCount: number
  anyFilter: boolean
  earliestMatchDateTime: string
  nowDateTime: string
  allExpanded: boolean
  recordCount: number
  filteredCount: number
  // "Include undated" toggle state. When false (default), records
  // missing date+finished_at are excluded from the matched view. The
  // toggle button only renders when undatedMatchCount > 0.
  includeUndated: boolean
  // Min-play threshold: a match qualifies only when at least one
  // candidate hero played the match for >= minPlayPercent OR
  // >= minPlayMinutes (OR semantics). Both default to 0 = disabled.
  minPlayPercent: number
  minPlayMinutes: number
}>()

const emit = defineEmits<{
  'update:filterFrom': [value: string]
  'update:filterTo': [value: string]
  'update:search': [field: string, value: string]
  'toggle-filter-panel': [field: string]
  'close-filter-panel': []
  'toggle-filter': [field: string, value: string]
  'select-all-filter': [field: string, options: string[]]
  'clear-filter-field': [field: string]
  'clear-filters': []
  'reset-date-range': []
  'toggle-sort': []
  'toggle-all': []
  'set-include-undated': [next: boolean]
  'set-min-play-percent': [n: number]
  'set-min-play-minutes': [n: number]
}>()

function readNumberInput(e: Event): number {
  const v = (e.target as HTMLInputElement).valueAsNumber
  return Number.isFinite(v) ? v : 0
}

// minPlayMinutes is persisted as a single fractional-minutes value.
// The UI splits it into whole-minutes + remainder-seconds so the user
// can type "0m 30s" instead of "0.5". Rounded to the nearest second to
// avoid floating-point drift in the displayed value.
const minutesWhole = computed(() => Math.floor(props.minPlayMinutes))
const secondsWhole = computed(() => Math.round((props.minPlayMinutes - minutesWhole.value) * 60))

// Emit a fresh total whenever either half of the m/s pair changes.
// Seconds outside [0, 59] fold into minutes (90s → +1m 30s) so the
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

// Mutual exclusion: the user picks ONE threshold, percent OR time.
// Whichever knob is currently engaged grays out the other half — the
// user must clear back to 0 before they can switch.
const percentDisabled = computed(() => props.minPlayMinutes > 0)
const timeDisabled    = computed(() => props.minPlayPercent > 0)

// Static per-field config. Options (roster) come in as props.
// `formatOption` runs every time a chip / row label renders, so it
// must be cheap — the heroDisplayName / mapDisplayName helpers are
// O(1) Map lookups and fall back to the input untouched until the
// /api/owdata fetch resolves.
const FIELD_CONFIG = [
  { field: 'mode',   label: 'Mode',   short: 'MODES',   optionKey: 'modes'   as const },
  { field: 'map',    label: 'Map',    short: 'MAPS',    optionKey: 'maps'    as const, formatOption: (v: string) => ow.mapDisplayName(v) },
  { field: 'type',   label: 'Type',   short: 'TYPES',   optionKey: 'types'   as const },
  { field: 'role',   label: 'Role',   short: 'ROLES',   optionKey: 'roles'   as const },
  { field: 'hero',   label: 'Hero',   short: 'HEROES',  optionKey: 'heroes'  as const, formatOption: (v: string) => ow.heroDisplayName(v) },
  { field: 'result', label: 'Result', short: 'RESULTS', optionKey: 'results' as const },
  { field: 'sshot',  label: 'Source', short: 'SOURCES', optionKey: 'sshotTypes' as const, formatOption: sshotTypeLabel },
] as const

type OptionKey = typeof FIELD_CONFIG[number]['optionKey']

function optionsFor(key: OptionKey): string[] {
  return props[key]
}

function searchStr(field: string): string {
  return props.filterSearch[field] ?? ''
}
</script>

<template>
  <section class="filter-rail">
    <div class="filter-grid">
      <div
        v-for="cfg in FIELD_CONFIG"
        :key="cfg.field"
        class="filter-field multi-filter"
        :class="{ open: openFilter === cfg.field, populated: filterList(cfg.field).length > 0 }"
      >
        <span class="filter-eyebrow">
          {{ cfg.label }}
          <span v-if="filterList(cfg.field).length" class="eyebrow-count">× {{ String(filterList(cfg.field).length).padStart(2, '0') }}</span>
        </span>

        <button
          type="button"
          class="mf-trigger"
          :aria-expanded="openFilter === cfg.field"
          :aria-label="`${cfg.label} filter, ${filterList(cfg.field).length} of ${optionsFor(cfg.optionKey).length} selected`"
          @click="emit('toggle-filter-panel', cfg.field)"
        >
          <span class="mf-trigger-inner">
            <template v-if="filterList(cfg.field).length === 0">
              <span class="mf-placeholder">All</span>
              <span class="mf-placeholder-meta">{{ optionsFor(cfg.optionKey).length }} {{ cfg.short.toLowerCase() }}</span>
            </template>
            <template v-else-if="filterList(cfg.field).length <= 2">
              <span
                v-for="val in filterList(cfg.field)"
                :key="val"
                class="mf-chip"
                :title="`Remove ${val} from filter`"
                @click.stop="emit('toggle-filter', cfg.field, val)"
              >
                <span class="mf-chip-text">{{ 'formatOption' in cfg ? cfg.formatOption(val) : val }}</span>
                <span class="mf-chip-x" aria-hidden="true">×</span>
              </span>
            </template>
            <template v-else>
              <span class="mf-chip mf-chip-stack">
                <span class="mf-chip-text">{{ 'formatOption' in cfg ? cfg.formatOption(filterList(cfg.field)[0] ?? '') : (filterList(cfg.field)[0] ?? '') }}</span>
                <span class="mf-chip-x" aria-hidden="true" />
              </span>
              <span class="mf-more">+{{ filterList(cfg.field).length - 1 }}</span>
            </template>
          </span>
          <span class="mf-caret" aria-hidden="true" />
        </button>

        <div v-if="openFilter === cfg.field" class="mf-panel" @click.stop>
          <div class="mf-panel-head">
            <span class="mf-panel-title">{{ cfg.short }} ROSTER</span>
            <span class="mf-panel-meta">{{ filterList(cfg.field).length }} / {{ optionsFor(cfg.optionKey).length }}</span>
          </div>
          <p class="mf-panel-hint">
            Picking multiple matches <em>any</em> of them.
          </p>
          <div v-if="optionsFor(cfg.optionKey).length >= 8" class="mf-search">
            <span class="mf-search-icon" aria-hidden="true">⌕</span>
            <input
              :value="filterSearch[cfg.field]"
              type="text"
              class="mf-search-input"
              :placeholder="`Search ${cfg.label.toLowerCase()}…`"
              autocomplete="off"
              @input="emit('update:search', cfg.field, ($event.target as HTMLInputElement).value)"
            >
          </div>
          <div class="mf-list" role="listbox" aria-multiselectable="true">
            <template v-for="opt in optionsFor(cfg.optionKey)" :key="opt">
              <label
                v-if="!searchStr(cfg.field) || ('formatOption' in cfg ? cfg.formatOption(opt) : opt).toLowerCase().includes(searchStr(cfg.field).toLowerCase())"
                class="mf-row"
                :class="{ checked: filterList(cfg.field).includes(opt) }"
              >
                <input
                  type="checkbox"
                  :checked="filterList(cfg.field).includes(opt)"
                  class="mf-row-box"
                  @change="emit('toggle-filter', cfg.field, opt)"
                >
                <span class="mf-row-mark" aria-hidden="true" />
                <span class="mf-row-label">{{ 'formatOption' in cfg ? cfg.formatOption(opt) : opt }}</span>
              </label>
            </template>
            <div v-if="optionsFor(cfg.optionKey).length === 0" class="mf-empty">
              No {{ cfg.label.toLowerCase() }} values yet — parse some matches to populate this filter.
            </div>
            <div
              v-else-if="searchStr(cfg.field) && optionsFor(cfg.optionKey).filter(o => o.toLowerCase().includes(searchStr(cfg.field).toLowerCase())).length === 0"
              class="mf-empty"
            >
              No {{ cfg.label.toLowerCase() }} matches "{{ searchStr(cfg.field) }}"
            </div>
          </div>
          <div class="mf-panel-foot">
            <button
              type="button"
              class="mf-foot-btn"
              :disabled="filterList(cfg.field).length === optionsFor(cfg.optionKey).length"
              @click="emit('select-all-filter', cfg.field, [...optionsFor(cfg.optionKey)])"
            >
              All
            </button>
            <button
              type="button"
              class="mf-foot-btn"
              :disabled="filterList(cfg.field).length === 0"
              @click="emit('clear-filter-field', cfg.field)"
            >
              None
            </button>
            <span class="mf-foot-spacer" />
            <button type="button" class="mf-foot-btn primary" @click="emit('close-filter-panel')">
              Done
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="filter-bar">
      <div class="range-group">
        <label class="range-label">
          <span>From</span>
          <input
            :value="filterFrom"
            type="datetime-local"
            :min="earliestMatchDateTime"
            :max="nowDateTime"
            class="dd-date"
            @change="emit('update:filterFrom', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <span class="range-dash">→</span>
        <label class="range-label">
          <span>To</span>
          <input
            :value="filterTo"
            type="datetime-local"
            :min="earliestMatchDateTime"
            :max="nowDateTime"
            class="dd-date"
            @change="emit('update:filterTo', ($event.target as HTMLInputElement).value)"
          >
        </label>
        <button
          class="btn ghost tiny"
          :disabled="!filterFrom && !filterTo"
          title="Clear both date pickers"
          @click="emit('reset-date-range')"
        >
          Reset
        </button>
        <span
          v-if="(filterFrom || filterTo) && undatedMatchCount > 0"
          class="range-hint"
          :title="`${undatedMatchCount} match${undatedMatchCount === 1 ? ' is' : 'es are'} missing date/time (no SUMMARY screenshot) and won't appear while a date filter is active.`"
        >
          ⓘ {{ undatedMatchCount }} undated hidden
        </span>
      </div>

      <div class="filter-tools">
        <button
          class="btn ghost tiny"
          :title="sortDir === 'desc' ? 'Newest first — click for oldest first' : 'Oldest first — click for newest first'"
          @click="emit('toggle-sort')"
        >
          {{ sortDir === 'desc' ? '↓ Newest' : '↑ Oldest' }}
        </button>
        <button
          class="btn ghost tiny"
          :title="allExpanded ? 'Collapse every visible card' : 'Expand every visible card'"
          @click="emit('toggle-all')"
        >
          {{ allExpanded ? 'Collapse All' : 'Expand All' }}
        </button>

        <!-- Min-play threshold. Three inputs sharing one eyebrow
             label: percent on the left, time (m + s) on the right,
             with an "or" divider between. Either side > 0 tints the
             whole group with the brand accent. Mutual exclusion is
             enforced via the disabled attribute on the inactive
             half — the user must clear one back to 0 before they
             can engage the other. Filter semantics: a match
             qualifies when any candidate hero meets the engaged
             threshold. -->
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

        <!-- Undated toggle. Only surfaces when at least one undated
             record exists; otherwise the toggle is meaningless. Shows
             count of undated records so the user knows what they'd
             see by flipping it. Active state gets the accent tint
             so it reads as "currently engaged". -->
        <button
          v-if="undatedMatchCount > 0"
          class="btn ghost tiny undated-toggle"
          :class="{ active: includeUndated }"
          :title="includeUndated
            ? `Hide the ${undatedMatchCount} undated match${undatedMatchCount === 1 ? '' : 'es'} (records with no SUMMARY screenshot to anchor a date).`
            : `Show the ${undatedMatchCount} undated match${undatedMatchCount === 1 ? '' : 'es'} (records with no SUMMARY screenshot to anchor a date). Default is to hide them.`"
          :aria-pressed="includeUndated"
          @click="emit('set-include-undated', !includeUndated)"
        >
          <span class="undated-mark" aria-hidden="true">{{ includeUndated ? '✓' : '+' }}</span>
          Undated · {{ undatedMatchCount }}
        </button>

        <button v-if="anyFilter" class="btn ghost tiny danger" @click="emit('clear-filters')">
          Clear Filters
        </button>
        <span class="count"><strong>{{ filteredCount }}</strong><span class="count-of">of {{ recordCount }}</span></span>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* ─── Filter rail container + grid ───────────────────────── */

.filter-rail {
  margin-top: 1.4rem;
  padding: 1rem 1.1rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
}

.filter-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 0.7rem;
}

.filter-field {
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  position: relative;
}

.filter-eyebrow {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  letter-spacing: 0.22em;
  text-transform: uppercase;
  transition: color 160ms ease;
}

.eyebrow-count {
  color: var(--accent-text);
  font-feature-settings: "tnum";
  letter-spacing: 0.14em;
  font-weight: 600;
}

.multi-filter.populated .filter-eyebrow { color: var(--text-dim); }

/* ─── Tactical multi-select trigger ──────────────────────── */

.mf-trigger {
  position: relative;
  display: flex;
  align-items: stretch;
  justify-content: space-between;
  gap: 0.5rem;
  width: 100%;
  min-height: 38px;
  padding: 0.35rem 0.5rem 0.35rem 0.6rem;
  font-family: var(--body);
  color: var(--text);
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  text-align: left;
  transition: border-color 140ms ease, background-color 140ms ease, box-shadow 140ms ease;
}

.mf-trigger::before,
.mf-trigger::after {
  /* Corner ticks — tiny L-marks at the top-left + bottom-right of
     the trigger, like an industrial spec plate. Fade in on hover. */
  content: '';
  position: absolute;
  width: 6px;
  height: 6px;
  border: 1px solid var(--accent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 160ms ease;
}

.mf-trigger::before {
  top: -1px; left: -1px;
  border-right: none; border-bottom: none;
}

.mf-trigger::after {
  bottom: -1px; right: -1px;
  border-left: none; border-top: none;
}

.mf-trigger:hover {
  border-color: var(--border-strong);
  background: var(--surface-3);
}

.mf-trigger:hover::before,
.mf-trigger:hover::after { opacity: 0.5; }

.multi-filter.open .mf-trigger {
  border-color: var(--accent);
  background: var(--surface-3);
  box-shadow: 0 0 0 1px var(--accent-soft) inset;
}

.multi-filter.open .mf-trigger::before,
.multi-filter.open .mf-trigger::after { opacity: 1; }
.multi-filter.populated .mf-trigger { border-color: var(--accent-soft); }

.mf-trigger-inner {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-wrap: nowrap;
  overflow: hidden;
  min-width: 0;
  flex: 1;
}

.mf-placeholder {
  font-family: var(--display);
  font-style: italic;
  font-size: 1rem;
  letter-spacing: 0.06em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.mf-placeholder-meta {
  margin-left: auto;
  padding-left: 0.6rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-mute);
  letter-spacing: 0.15em;
  text-transform: uppercase;
  white-space: nowrap;
}

/* ─── Chips inside the trigger ───────────────────────────── */

.mf-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  padding: 0.18rem 0.4rem 0.18rem 0.5rem;
  background: var(--accent);
  color: var(--primary-text-on-accent);
  border-radius: 1px;
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: capitalize;
  max-width: 100%;
  cursor: pointer;
  animation: chip-in 220ms cubic-bezier(0.2, 0.7, 0.3, 1.4);
  transition: background 140ms ease, transform 120ms ease;
}

.mf-chip:hover {
  background: var(--accent-bright);
  transform: translateY(-1px);
}

.mf-chip-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-chip-x {
  font-family: var(--body);
  font-size: 0.85rem;
  line-height: 1;
  font-weight: 700;
  opacity: 0.55;
  margin-right: -0.05rem;
}
.mf-chip:hover .mf-chip-x { opacity: 1; }
.mf-chip-stack { padding-right: 0.5rem; }

.mf-more {
  display: inline-flex;
  align-items: center;
  padding: 0.18rem 0.35rem;
  background: var(--brand-gray);
  color: #f1f1f1;
  border-radius: 1px;
  font-family: var(--mono);
  font-size: 0.65rem;
  font-weight: 600;
  letter-spacing: 0.08em;
}

.mf-caret {
  width: 8px;
  height: 8px;
  flex-shrink: 0;
  border-right: 1px solid var(--text-dim);
  border-bottom: 1px solid var(--text-dim);
  transform: translateY(-2px) rotate(45deg);
  transition: transform 220ms ease, border-color 160ms ease;
  align-self: center;
}

.multi-filter.open .mf-caret {
  transform: translateY(2px) rotate(-135deg);
  border-color: var(--accent);
}

@keyframes chip-in {
  0%   { transform: scale(0.7) translateY(2px); opacity: 0; }
  60%  { transform: scale(1.05) translateY(0); opacity: 1; }
  100% { transform: scale(1) translateY(0); opacity: 1; }
}

/* ─── Popover panel ──────────────────────────────────────── */

.mf-panel {
  position: absolute;
  z-index: 40;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  min-width: 220px;
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: 2px;
  box-shadow:
    0 24px 60px -18px rgb(0 0 0 / 70%),
    0 0 0 1px var(--accent-soft);
  display: flex;
  flex-direction: column;
  max-height: 360px;
  overflow: hidden;
  animation: panel-in 180ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
  transform-origin: top center;
}

@keyframes panel-in {
  from { opacity: 0; transform: translateY(-6px) scaleY(0.92); }
  to   { opacity: 1; transform: translateY(0)    scaleY(1); }
}

.mf-panel-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0.7rem;
  background:
    repeating-linear-gradient(
      135deg,
      var(--brand-gray) 0 12px,
      #3a3a3a 12px 24px
    );
  border-bottom: 1px solid var(--accent);
  color: #f1f1f1;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
}
.mf-panel-title { font-weight: 700; }

.mf-panel-meta {
  color: var(--accent);
  font-feature-settings: "tnum";
  letter-spacing: 0.18em;
}

/* One-line hint under the panel head — explains the multi-select union
   semantics so users aren't guessing whether picks AND together. */
.mf-panel-hint {
  margin: 0;
  padding: 0.4rem 0.7rem;
  background: var(--surface-2);
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  border-bottom: 1px solid var(--hairline);
}

.mf-panel-hint em {
  font-style: normal;
  color: var(--accent);
  font-weight: 700;
}

.mf-search {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.7rem;
  border-bottom: 1px dashed var(--border);
  background: var(--surface-2);
}

.mf-search-icon {
  font-family: var(--mono);
  font-size: 0.9rem;
  color: var(--text-faint);
}

.mf-search-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text);
  font-family: var(--body);
  font-size: 0.84rem;
  padding: 0.2rem 0;
}

.mf-search-input::placeholder {
  color: var(--text-mute);
  font-style: italic;
}

.mf-list {
  overflow-y: auto;
  padding: 0.3rem 0;
  flex: 1 1 auto;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}
.mf-list::-webkit-scrollbar { width: 6px; }

.mf-list::-webkit-scrollbar-thumb {
  background: var(--border-strong);
  border-radius: 3px;
}

.mf-row {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.45rem 0.7rem;
  cursor: pointer;
  font-family: var(--body);
  font-size: 0.86rem;
  color: var(--text-dim);
  text-transform: capitalize;
  user-select: none;
  position: relative;
  transition: background 100ms ease, color 100ms ease;
}

.mf-row:hover {
  background: var(--surface-2);
  color: var(--text);
}

.mf-row.checked {
  color: var(--text);
  background: var(--accent-soft);
}

.mf-row.checked::before {
  content: '';
  position: absolute;
  inset: 0;
  border-left: 2px solid var(--accent);
  pointer-events: none;
}

.mf-row-box {
  /* The real checkbox lives behind .mf-row-mark for accessibility. */
  position: absolute;
  opacity: 0;
  width: 1px; height: 1px;
  pointer-events: none;
}

.mf-row-mark {
  position: relative;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1px solid var(--border-strong);
  background: var(--surface);
  transition: background 120ms ease, border-color 120ms ease;
}

.mf-row.checked .mf-row-mark {
  background: var(--accent);
  border-color: var(--accent);
}

.mf-row.checked .mf-row-mark::after {
  content: '';
  position: absolute;
  left: 3px;
  top: 0;
  width: 4px;
  height: 8px;
  border-right: 2px solid var(--primary-text-on-accent);
  border-bottom: 2px solid var(--primary-text-on-accent);
  transform: rotate(45deg);
  animation: mark-in 160ms cubic-bezier(0.2, 0.7, 0.3, 1.4);
}

@keyframes mark-in {
  from { opacity: 0; transform: rotate(45deg) scale(0.4); }
  to   { opacity: 1; transform: rotate(45deg) scale(1); }
}

.mf-row-label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mf-row-box:focus-visible + .mf-row-mark {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.mf-empty {
  padding: 0.8rem 0.7rem;
  text-align: center;
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  letter-spacing: 0.08em;
  font-style: italic;
}

.mf-panel-foot {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.4rem 0.5rem;
  border-top: 1px solid var(--border);
  background: var(--surface-2);
}
.mf-foot-spacer { flex: 1; }

.mf-foot-btn {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.35rem 0.6rem;
  background: transparent;
  color: var(--text-dim);
  border: 1px solid var(--border);
  border-radius: 1px;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background 120ms ease;
}

.mf-foot-btn:hover:not(:disabled) {
  color: var(--text);
  border-color: var(--text-dim);
}

.mf-foot-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.mf-foot-btn.primary {
  background: var(--accent);
  color: var(--primary-text-on-accent);
  border-color: var(--accent);
  font-weight: 700;
}

.mf-foot-btn.primary:hover {
  background: var(--accent-bright);
  border-color: var(--accent-bright);
}

/* ─── Filter bar (date range + tools) ────────────────────── */

.filter-bar {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 0.8rem;
  margin-top: 0.9rem;
  padding-top: 0.9rem;
  border-top: 1px dashed var(--border);
}

.range-group {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  flex-wrap: wrap;
}

.range-label {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  font-family: var(--mono);
  font-size: 0.65rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.18em;
}

.range-dash {
  color: var(--text-mute);
  font-family: var(--mono);
  font-size: 0.85rem;
}

/* Hint shown beside the Reset button when an active date filter is
   excluding rows that lack a parseable date+finished_at. */
.range-hint {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  margin-left: 0.4rem;
  padding: 0.18rem 0.5rem;
  background: var(--surface-2);
  border: 1px dashed var(--border);
  border-radius: 2px;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: help;
  font-feature-settings: "tnum";
}

.dd-date {
  background: var(--surface-2);
  color: var(--text);
  font-family: var(--mono);
  border: 1px solid var(--border);
  border-radius: 2px;
  padding: 0.35rem 0.5rem;
  font-size: 0.82rem;
  color-scheme: dark;
  letter-spacing: 0;
  text-transform: none;
}

.dd-date:focus {
  outline: none;
  border-color: var(--accent);
}

.filter-tools {
  display: flex;
  align-items: center;
  gap: 0.45rem;
  flex-wrap: wrap;
}

.count-of { color: var(--text-faint); font-size: 0.72rem; }

/* ─── Undated toggle ─────────────────────────────────────── */

/* Undated toggle — sits between Expand All and Clear Filters. Ghost
   styling by default (off / "show me what I'm hiding"); the active
   state tints with the brand accent so it reads as "currently
   engaged" without needing a separate icon swap. */

.undated-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.32rem;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  transition: color 140ms ease, background 140ms ease, border-color 140ms ease;
}

.undated-mark {
  font-weight: 600;
  font-size: 0.85rem;
  line-height: 1;
  display: inline-flex;
  width: 0.95em;
  height: 0.95em;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  border: 1px solid currentcolor;
  opacity: 0.7;
  transform: translateY(-0.5px);
}

/* Active state: the toggle is ON, undated rows are being included.
   Inherits the standard active-pill treatment used elsewhere in the
   filter rail (accent color + soft accent background). */
.undated-toggle.active {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft, transparent);
}

.undated-toggle.active .undated-mark {
  opacity: 1;
}

/* Min-play threshold — two narrow number inputs sharing one eyebrow
   label, ghost styling so they read as ambient knobs in the filter
   tools row. When either input is non-zero (`.active`), the whole
   group tints with the brand accent the same way `.undated-toggle.active`
   does, so the user can scan the row and immediately spot every
   engaged filter. */

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

.min-play-group:hover { border-color: var(--border-strong); }

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
  opacity: 0.55;
}
</style>

<script setup lang="ts">
import { sshotTypeLabel } from '../match-helpers'

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

// Static per-field config. Options (roster) come in as props.
const FIELD_CONFIG = [
  { field: 'mode',   label: 'Mode',   short: 'MODES',   optionKey: 'modes'   as const },
  { field: 'map',    label: 'Map',    short: 'MAPS',    optionKey: 'maps'    as const },
  { field: 'type',   label: 'Type',   short: 'TYPES',   optionKey: 'types'   as const },
  { field: 'role',   label: 'Role',   short: 'ROLES',   optionKey: 'roles'   as const },
  { field: 'hero',   label: 'Hero',   short: 'HEROES',  optionKey: 'heroes'  as const },
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

        <!-- Min-play threshold. Two narrow inputs sharing one eyebrow
             label. Either > 0 tints the whole group with the brand
             accent so the "this filter is engaged" state is obvious
             at a glance. Filter semantics live in useMatchFilters —
             a match qualifies when any candidate hero meets EITHER
             threshold (OR), so the user reads it as "1 min OR 5%". -->
        <div
          class="min-play-group"
          :class="{ active: minPlayPercent > 0 || minPlayMinutes > 0 }"
          role="group"
          aria-label="Minimum play threshold"
        >
          <span class="min-play-eyebrow">Min play</span>
          <label class="min-play-cell">
            <input
              type="number"
              inputmode="numeric"
              min="0"
              max="100"
              step="1"
              class="min-play-input"
              :value="minPlayPercent || ''"
              placeholder="0"
              aria-label="Minimum percent of match played"
              title="Hide matches where the selected hero played less than this share of the match. 0 = off."
              @change="emit('set-min-play-percent', readNumberInput($event))"
            >
            <span class="min-play-unit">%</span>
          </label>
          <span class="min-play-or" aria-hidden="true">or</span>
          <label class="min-play-cell">
            <input
              type="number"
              inputmode="decimal"
              min="0"
              max="60"
              step="0.5"
              class="min-play-input"
              :value="minPlayMinutes || ''"
              placeholder="0"
              aria-label="Minimum minutes played"
              title="Hide matches where the selected hero played less than this many minutes. 0 = off. Needs the SUMMARY screenshot for game length."
              @change="emit('set-min-play-minutes', readNumberInput($event))"
            >
            <span class="min-play-unit">m</span>
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

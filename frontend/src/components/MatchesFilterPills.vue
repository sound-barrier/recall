<script setup lang="ts">
import { computed } from 'vue'
import { sshotTypeLabel } from '../match-helpers'
import { useOWData } from '../composables/useOWData'
import type { SearchClause } from '../search-query'

// Active-filter summary. Renders every currently-engaged filter
// (multi-selects, date range, note search) as a removable chip on
// one line directly above the match list. Each chip's × removes
// just that filter; a "Clear all" button on the right resets every
// active filter at once.
//
// Hides itself entirely when no filter is active, so the page only
// gains the strip when there's actually something to summarise.
// Renders as a sticky strip just under the FilterRail so the
// "what am I looking at" answer is always one glance away.
//
// Notably: this component is presentation-only. It receives the
// active state via props (already computed by useMatchFilters) and
// emits removal intents back up; the parent translates each emit
// into the corresponding filter-clearing action.

const ow = useOWData()

const props = defineProps<{
  // Multi-select active values, keyed by field name. Empty array =
  // not engaged. Same shape useMatchFilters exposes via
  // `filterRefs[field].value`.
  modes:   string[]
  maps:    string[]
  types:   string[]
  roles:   string[]
  heroes:  string[]
  results: string[]
  sshots:  string[]
  tags:    string[]
  // Match-search state. `matchQuery` is the raw user-typed string;
  // `searchClauses` is the parsed list — one chip per clause so the
  // user can drop individual clauses from the active-filter strip.
  matchQuery:    string
  searchClauses: SearchClause[]
  filterFrom:    string
  filterTo:      string
  // The "any filter engaged" flag — single source of truth for
  // whether the strip should render at all. Mirrors useMatchFilters'
  // anyFilter computed.
  anyFilter:  boolean
}>()

const emit = defineEmits<{
  // User clicks the × on a multi-select chip — the parent removes
  // (field, value) from the corresponding filter array. Same emit
  // signature as the toggle-filter event on the existing chip
  // dropdowns, so the parent can reuse its handler.
  'remove-filter':       [field: string, value: string]
  // Per-field clears for the singleton filters (no per-value chips).
  'clear-match-query':   []
  'clear-date-range':    []
  // One-shot "reset everything" button.
  'clear-all':           []
}>()

// One row in the chip list. Carries enough metadata that the
// template can render every chip via a v-for instead of branching
// per filter family. `removeArgs` is the tuple passed to
// remove-filter; null means the chip uses a different emit.
interface PillRow {
  key:         string
  field:       string         // for the data-field attribute (tests / styling)
  label:       string         // short eyebrow ("Mode", "Hero", …)
  value:       string         // user-facing text in the chip
  removeArgs:  [string, string] | null
  clearEvent?: 'clear-match-query' | 'clear-date-range'
}

// Build the flat pill list reactively from the eight multi-select
// arrays + the two singleton inputs. Order mirrors the FilterRail's
// FIELD_CONFIG: mode, map, type, role, hero, result, source, tags,
// then note search, then date range. Display formatting (canonical
// hero/map spellings, sshot-type labels) routes through the same
// helpers the chip dropdowns use, so the values match byte-for-byte
// between the rail and the active-pills strip.
const pills = computed<PillRow[]>(() => {
  const out: PillRow[] = []
  const push = (field: string, label: string, values: string[], format?: (v: string) => string) => {
    for (const v of values) {
      out.push({
        key:        `${field}:${v}`,
        field,
        label,
        value:      format ? format(v) : v,
        removeArgs: [field, v],
      })
    }
  }
  push('mode',   'Mode',   props.modes)
  push('map',    'Map',    props.maps,   ow.mapDisplayName)
  push('type',   'Type',   props.types)
  push('role',   'Role',   props.roles)
  push('hero',   'Hero',   props.heroes, ow.heroDisplayName)
  push('result', 'Result', props.results)
  push('sshot',  'Source', props.sshots, sshotTypeLabel)
  push('tags',   'Tag',    props.tags)

  // Active search clauses each get their own chip — drop individually
  // via the × or wipe them all via "Clear all". Scoped clauses
  // surface their field (NOTE / REPLAY / MEMBER / TAG); bare clauses
  // render as ANY so the global-vs-scoped distinction stays visible.
  // The whole batch routes through `clear-match-query` because we
  // wipe the raw query string rather than reconstruct it from the
  // surviving subset — the in-rail × already covers per-clause
  // removal, and reconstructing here would double the logic.
  if (props.searchClauses.length) {
    out.push({
      key:        'search-query',
      field:      'match-search',
      label:      'Search',
      // `:value` joined back into a single readable token list — the
      // active-pills strip is a summary, not an editor.
      value:      `"${props.matchQuery.trim()}"`,
      removeArgs: null,
      clearEvent: 'clear-match-query',
    })
  }

  if (props.filterFrom || props.filterTo) {
    const from = props.filterFrom ? props.filterFrom.replace('T', ' ') : '…'
    const to   = props.filterTo   ? props.filterTo.replace('T', ' ')   : '…'
    out.push({
      key:        'date-range',
      field:      'date-range',
      label:      'Range',
      value:      `${from} → ${to}`,
      removeArgs: null,
      clearEvent: 'clear-date-range',
    })
  }
  return out
})

function onRemove(p: PillRow) {
  if (p.removeArgs) {
    emit('remove-filter', p.removeArgs[0], p.removeArgs[1])
  } else if (p.clearEvent === 'clear-match-query') {
    emit('clear-match-query')
  } else if (p.clearEvent === 'clear-date-range') {
    emit('clear-date-range')
  }
}
</script>

<template>
  <div v-if="anyFilter && pills.length" class="filter-pills" role="region" aria-label="Active filters">
    <span class="filter-pills-eyebrow">
      Active · {{ String(pills.length).padStart(2, '0') }}
    </span>
    <ul class="filter-pills-list">
      <li
        v-for="p in pills"
        :key="p.key"
        class="filter-pill"
        :data-field="p.field"
      >
        <span class="filter-pill-label">{{ p.label }}</span>
        <span class="filter-pill-value">{{ p.value }}</span>
        <button
          type="button"
          class="filter-pill-x"
          :aria-label="`Remove ${p.label} filter: ${p.value}`"
          @click="onRemove(p)"
        >
          ×
        </button>
      </li>
    </ul>
    <button
      type="button"
      class="filter-pills-clear"
      title="Reset every active filter"
      @click="emit('clear-all')"
    >
      Clear all
    </button>
  </div>
</template>

<style scoped>
/* Single horizontal strip. Sticky-feel via the small margin above
   that separates it from the FilterRail — no actual position:sticky
   because the rail itself isn't sticky, and stacking the two would
   break scroll context. */

.filter-pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-top: 0.75rem;
  padding: 0.55rem 0.7rem;
  background: var(--surface-2);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  animation: filter-pills-in 220ms ease both;
}

.filter-pills-eyebrow {
  font-family: var(--mono);
  font-size: 0.58rem;
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--accent);
  font-variant-numeric: tabular-nums;
  flex: 0 0 auto;
}

.filter-pills-list {
  display: contents;
  list-style: none;
  margin: 0;
  padding: 0;
}

.filter-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.32rem 0.18rem 0.55rem;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.06em;
  color: var(--text-dim);
  transition: border-color 140ms ease, color 140ms ease;
}

.filter-pill:hover {
  border-color: var(--accent-soft);
  color: var(--text);
}

.filter-pill-label {
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
}

.filter-pill-value {
  color: var(--text);
  font-weight: 600;
  letter-spacing: 0.04em;
  max-width: 22ch;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Result chips get a tint per outcome so the active filter strip
   carries the same semantic color as the result chip on the card
   header. Subtle background, not full saturation. */
.filter-pill[data-field="result"][data-field="result"] .filter-pill-value {
  /* compound selector keeps specificity above the base value rule */
  color: var(--text);
}

.filter-pill-x {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-left: 0.1rem;
  border: 0;
  background: transparent;
  color: var(--text-faint);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  border-radius: 1px;
  transition: color 140ms ease, background 140ms ease;
}

.filter-pill-x:hover {
  color: var(--loss);
  background: var(--loss-soft);
}

.filter-pill-x:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.filter-pills-clear {
  margin-left: auto;
  padding: 0.22rem 0.6rem;
  background: transparent;
  border: 1px dashed var(--border-strong);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease;
}

.filter-pills-clear:hover {
  color: var(--accent);
  border-color: var(--accent);
  background: var(--accent-soft);
}

.filter-pills-clear:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--accent-soft);
}

@keyframes filter-pills-in {
  from { opacity: 0; transform: translateY(-3px); }
  to   { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .filter-pills { animation: none; }
}
</style>

<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useOWData } from '@/composables/shared/useOWData'
import {
  formatRowDate,
  formatFinishedAt,
  isEditedMatch,
  isHeroUnknown,
  isManualMatch,
  isMapUnknown,
  rolePlays,
  sortedHeroPlays,
} from '@/match/match-helpers'
import {
  formatPlayModeLabel,
  formatQueueTypeLabel,
  formatUnknownHeroLabel,
  formatUnknownMapLabel,
} from '@/match/match-label-helpers'
import { highlightTermsFor, type SearchClause } from '@/match/search-query'
import HighlightedText from '@/components/matches/shared/HighlightedText.vue'

// One <tr> in the data-density match table. Carries the SAME props +
// emits as MatchLeafRow so MatchesView wires every interaction (click →
// detail, select, context-menu, hover-preview, anchor, j/k focus)
// identically; only the rendering differs — table cells, not a card
// grid. Reuses HighlightedText (the scoped-search highlight) on the
// free-text cells, and the shared .leaf-checkbox styling (app.css).
const props = defineProps<{
  rec: MatchRecord
  cardIndex: number
  focusedCardIndex?: number
  selected: boolean
  hasSelection: boolean
  isAnchor: boolean
  searchClauses: SearchClause[]
  // The active narrow picks — a value cell whose value is in its set renders as
  // an active filter (every value cell filters; sorting is the column headers').
  activeFilters?: {
    maps: ReadonlySet<string>
    modes: ReadonlySet<string>
    queues: ReadonlySet<string>
    heroes: ReadonlySet<string>
    roles: ReadonlySet<string>
    results: ReadonlySet<string>
  }
  // Column indices selected for this row by the cell range-select (empty = none).
  selectedCols?: number[]
}>()

// Is the data cell at `col` (index into TABLE_SORT_COLUMNS) in the range-select?
function sel(col: number): boolean {
  return props.selectedCols?.includes(col) ?? false
}

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'filter-cell': [field: 'map' | 'result' | 'mode' | 'queue' | 'hero' | 'role', value: string]
  'toggle-select': [matchKey: string]
  'row-context': [event: MouseEvent, matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
}>()

const ow = useOWData()

// Click-to-filter pick values for the mode + queue cells (the narrow's
// PlayModePick / QueuePick unions), derived the same way the labels are.
const playModePick = computed(() => {
  const m = props.rec.play_mode ?? props.rec.data?.playlist
  return m === 'quickplay' || m === 'competitive' ? m : 'unknown'
})
const queuePick = computed(() => {
  const q = props.rec.queue_type
  return q === 'role' || q === 'open' ? q : 'unknown'
})

// Whether each value cell is currently an active narrow filter (lights it up).
const mapFiltered = computed(() => props.activeFilters?.maps.has(props.rec.data?.map ?? '') ?? false)
const resultFiltered = computed(() => props.activeFilters?.results.has(props.rec.data?.result ?? '') ?? false)
const modeFiltered = computed(() => props.activeFilters?.modes.has(playModePick.value) ?? false)
const queueFiltered = computed(() => props.activeFilters?.queues.has(queuePick.value) ?? false)
const heroFiltered = (hero: string) => props.activeFilters?.heroes.has(hero) ?? false
const roleFiltered = (role: string) => props.activeFilters?.roles.has(role) ?? false

const isFocused = computed(
  () => props.focusedCardIndex !== undefined && props.cardIndex === props.focusedCardIndex,
)
const bareTerms = computed(() => props.searchClauses.filter((c) => c.field === null).map((c) => c.value))
const tagTerms = computed(() => highlightTermsFor('tag', props.searchClauses))
</script>

<template>
  <tr
    class="table-row"
    tabindex="-1"
    :data-match-key="rec.match_key"
    :data-card-index="cardIndex"
    :aria-current="isFocused ? 'true' : undefined"
    :class="[
      `result-${rec.data?.result || 'unknown'}`,
      {
        'has-selection': hasSelection,
        'is-ticked': selected,
        'kbd-focused': isFocused,
        'is-anchor': isAnchor,
      },
    ]"
    @click="emit('open-match', rec.match_key)"
    @contextmenu="emit('row-context', $event, rec.match_key)"
    @mouseenter="emit('hover-enter', rec, $event)"
    @mousemove="emit('hover-move', $event)"
    @mouseleave="emit('hover-leave')"
  >
    <td class="tc tc-check">
      <button
        type="button"
        class="leaf-checkbox"
        role="checkbox"
        :aria-checked="selected ? 'true' : 'false'"
        :aria-label="`Select match ${rec.match_key}`"
        @click.stop="emit('toggle-select', rec.match_key)"
      >
        <span class="leaf-checkbox-glyph" aria-hidden="true">{{ selected ? '✓' : '' }}</span>
      </button>
    </td>
    <td class="tc tc-date" :data-col="0" :class="{ 'is-cell-selected': sel(0) }">
      <span class="tc-date-d">{{ formatRowDate(rec) }}</span>
      <span class="tc-date-t">{{ formatFinishedAt(rec) }}</span>
    </td>
    <td class="tc tc-map" :data-col="1" :class="{ 'is-cell-selected': sel(1) }">
      <span
        v-if="isMapUnknown(rec)"
        class="tc-unknown"
        :title="`OCR read: ${rec.data?.map_raw ?? '—'}`"
      >{{ formatUnknownMapLabel(rec) }}</span>
      <button
        v-else
        type="button"
        class="tc-filter-cell"
        :class="{ 'is-filtered': mapFiltered }"
        :title="mapFiltered ? `Filtering by ${rec.data?.map} — click to clear` : `Filter the set to ${rec.data?.map}`"
        @click.stop="emit('filter-cell', 'map', rec.data?.map ?? '')"
      >
        <HighlightedText :text="rec.data?.map || 'unknown'" :terms="bareTerms" />
      </button>
    </td>
    <td class="tc tc-mode" :data-col="2" :class="{ 'is-cell-selected': sel(2) }">
      <button
        type="button"
        class="tc-chip tc-filter-cell"
        :class="{ 'is-filtered': modeFiltered }"
        :title="modeFiltered ? `Filtering by ${formatPlayModeLabel(rec)} — click to clear` : `Filter the set to ${formatPlayModeLabel(rec)}`"
        @click.stop="emit('filter-cell', 'mode', playModePick)"
      >
        {{ formatPlayModeLabel(rec) }}
      </button>
    </td>
    <td class="tc tc-queue" :data-col="3" :class="{ 'is-cell-selected': sel(3) }">
      <button
        type="button"
        class="tc-chip tc-filter-cell"
        :class="{ 'is-filtered': queueFiltered }"
        :title="queueFiltered ? `Filtering by ${formatQueueTypeLabel(rec)} — click to clear` : `Filter the set to ${formatQueueTypeLabel(rec)}`"
        @click.stop="emit('filter-cell', 'queue', queuePick)"
      >
        {{ formatQueueTypeLabel(rec) }}
      </button>
    </td>
    <td class="tc tc-hero" :data-col="4" :class="{ 'is-cell-selected': sel(4) }">
      <span
        v-if="isHeroUnknown(rec)"
        class="tc-unknown"
        :title="`OCR read: ${rec.data?.hero_raw ?? '—'}`"
      >{{ formatUnknownHeroLabel(rec) }}</span>
      <span v-else class="tc-hero-chips">
        <button
          v-for="h in sortedHeroPlays(rec)"
          :key="h.hero"
          type="button"
          class="tc-hero-chip tc-filter-cell"
          :class="{ 'is-filtered': heroFiltered(h.hero) }"
          :aria-pressed="heroFiltered(h.hero) ? 'true' : 'false'"
          :title="heroFiltered(h.hero) ? `Filtering by ${h.hero} — click to clear` : `Filter the set to ${h.hero}`"
          @click.stop="emit('filter-cell', 'hero', h.hero)"
        ><HighlightedText :text="h.hero" :terms="bareTerms" /></button>
      </span>
    </td>
    <td class="tc tc-role" :data-col="5" :class="{ 'is-cell-selected': sel(5) }">
      <span class="tc-role-chips">
        <button
          v-for="r in rolePlays(rec, ow.heroRole)"
          :key="r.role"
          type="button"
          class="tc-role-chip tc-filter-cell"
          :class="{ 'is-filtered': roleFiltered(r.role) }"
          :aria-pressed="roleFiltered(r.role) ? 'true' : 'false'"
          :title="roleFiltered(r.role) ? `Filtering by ${r.role} — click to clear` : `Filter the set to ${r.role}`"
          @click.stop="emit('filter-cell', 'role', r.role)"
        >{{ r.role }}</button>
      </span>
    </td>
    <td class="tc tc-stat-cell tc-elim" :data-col="6" :class="{ 'is-cell-selected': sel(6) }">
      {{ rec.data?.eliminations ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-assist" :data-col="7" :class="{ 'is-cell-selected': sel(7) }">
      {{ rec.data?.assists ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-death" :data-col="8" :class="{ 'is-cell-selected': sel(8) }">
      {{ rec.data?.deaths ?? '—' }}
    </td>
    <td class="tc tc-tags" :data-col="9" :class="{ 'is-cell-selected': sel(9) }">
      <span
        v-if="rec.annotation?.leaver"
        class="tc-leaver"
        :title="`Leaver: ${rec.annotation.leaver}`"
      >L</span>
      <span
        v-for="t in rec.annotation?.tags ?? []"
        :key="t"
        class="tc-tag"
      >#<HighlightedText :text="t" :terms="tagTerms" /></span>
    </td>
    <td class="tc tc-prov" :data-col="10" :class="{ 'is-cell-selected': sel(10) }">
      <input
        type="checkbox"
        class="tc-prov-box"
        disabled
        :checked="isEditedMatch(rec)"
        :aria-label="isEditedMatch(rec) ? 'Edited after parsing' : 'Not edited'"
      >
    </td>
    <td class="tc tc-prov" :data-col="11" :class="{ 'is-cell-selected': sel(11) }">
      <input
        type="checkbox"
        class="tc-prov-box"
        disabled
        :checked="isManualMatch(rec)"
        :aria-label="isManualMatch(rec) ? 'Hand-entered match' : 'Not hand-entered'"
      >
    </td>
    <td class="tc tc-result" :data-col="12" :class="{ 'is-cell-selected': sel(12) }">
      <button
        type="button"
        class="tc-result-chip tc-filter-cell"
        :class="[`result-${rec.data?.result || 'unknown'}`, { 'is-filtered': resultFiltered }]"
        :disabled="!rec.data?.result"
        :title="!rec.data?.result ? undefined : resultFiltered ? `Filtering by ${rec.data.result} — click to clear` : `Filter the set to ${rec.data.result}`"
        @click.stop="rec.data?.result && emit('filter-cell', 'result', rec.data.result)"
      >
        {{ rec.data?.result || '—' }}
      </button>
    </td>
  </tr>
</template>

<style scoped>
.table-row {
  cursor: pointer;
  border-bottom: 1px solid color-mix(in srgb, var(--border) 45%, transparent);
  transition: background 120ms ease;
}

.table-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, transparent);
}

.table-row.is-ticked {
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.table-row.kbd-focused {
  outline: 1px solid var(--accent);
  outline-offset: -1px;
}

.table-row.is-anchor {
  box-shadow: inset 3px 0 0 0 var(--accent);
}

/* The contextual checkbox shares .leaf-checkbox (app.css base); wire its
   reveal-on-interaction here for the table-row ancestor. */
.table-row:hover .leaf-checkbox,
.table-row.has-selection .leaf-checkbox,
.table-row.is-ticked .leaf-checkbox,
.leaf-checkbox:focus-visible {
  opacity: 1;
}

.tc {
  padding: 0.32rem 0.55rem;
  vertical-align: middle;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text);
  white-space: nowrap;
}

/* Cell range-select highlight. Specificity beats the row hover/ticked + frozen
   cell backgrounds so a selected cell always reads as selected. */
.table-row .tc.is-cell-selected {
  background: color-mix(in srgb, var(--accent) 25%, var(--surface-2));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent);
}

/* Frozen leading columns (mirror the header freeze in MatchesTable): select +
   Date stay pinned-left during horizontal scroll. They need an opaque bg so the
   scrolling cells pass UNDER them — the row's own bg is transparent and would
   let content show through — so the row's hover/ticked tints are replicated. */
.tc-check,
.tc-date {
  position: sticky;
  z-index: 1;
  background: var(--surface-2);
}

.table-row:hover .tc-check,
.table-row:hover .tc-date { background: color-mix(in srgb, var(--accent) 6%, var(--surface-2)); }

.table-row.is-ticked .tc-check,
.table-row.is-ticked .tc-date { background: color-mix(in srgb, var(--accent) 12%, var(--surface-2)); }

.tc-check { width: 1.6rem; padding-right: 0; left: 0; }

.tc-date {
  line-height: 1.15;
  left: 34px;
  border-right: 1px solid var(--border-strong);
}
.tc-date-d { color: var(--text); font-weight: 700; letter-spacing: 0.03em; }
.tc-date-t { color: var(--text-faint); margin-left: 0.35rem; font-size: 0.62rem; }

.tc-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 0.92rem;
  text-transform: uppercase;
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--identity-accent);
}

.tc-hero {
  font-weight: 700;
  text-transform: lowercase;
  max-width: 12rem;
  color: var(--identity-accent);
}

/* Each hero is a clickable filter chip — click filters the set by that hero. */
.tc-hero-chips { display: inline-flex; flex-wrap: wrap; gap: 1px 2px; }

.tc-hero-chip {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0 0.2rem;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border-radius: 2px;
  transition: background 120ms ease, color 120ms ease;
}
.tc-hero-chip:hover { background: color-mix(in srgb, var(--identity-accent) 18%, transparent); }
.tc-hero-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* Each role is a clickable filter chip — click filters the set by that role
   (open-queue matches can show several). Keeps the faint uppercase look. */
.tc-role-chips { display: inline-flex; flex-wrap: wrap; gap: 1px 3px; }

.tc-role-chip {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0 0.2rem;
  font: inherit;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.14em;
  font-size: 0.58rem;
  cursor: pointer;
  border-radius: 2px;
  transition: background 120ms ease, color 120ms ease;
}
.tc-role-chip:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); }
.tc-role-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.tc-chip {
  font-size: 0.52rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* E / A / D each own a column now — display-italic numerals, deaths
   dimmed so a glance reads kills-over-deaths. Right-aligned so the
   digits line up column-wise like a spreadsheet. */
.tc-stat-cell {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.85rem;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.tc-death { color: var(--text-dim); }

.tc-tags { white-space: normal; max-width: 12rem; }

.tc-tag {
  font-size: 0.58rem;
  color: var(--accent);
  margin-right: 0.3rem;
}

.tc-leaver {
  font-weight: 800;
  color: var(--loss);
  margin-right: 0.3rem;
  font-size: 0.6rem;
}

/* Provenance columns (Edited · User entered): a read-only checkbox per
   row. `disabled` makes it a non-interactive indicator — the click
   falls through to the row's open-match handler — while still reading
   as a checkbox to assistive tech. `opacity: 1` overrides the UA's
   greyed-disabled wash so a ticked box stays clearly visible. */
.tc-prov { text-align: center; }

.tc-prov-box {
  margin: 0;
  accent-color: var(--accent);
  opacity: 1;
  cursor: default;
}

.tc-unknown { color: var(--accent-bright, var(--accent)); cursor: help; }

.tc-result { text-align: right; }

.tc-result-chip {
  font-size: 0.58rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  font-weight: 800;
  padding: 0.18rem 0.5rem;
  border-radius: 2px;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-faint);
}

.tc-result-chip.result-victory {
  background: color-mix(in srgb, var(--win) 22%, var(--surface));
  border-color: var(--win-line, var(--win));
  color: var(--win);
}

.tc-result-chip.result-defeat {
  background: color-mix(in srgb, var(--loss) 22%, var(--surface));
  border-color: var(--loss-line, var(--loss));
  color: var(--loss);
}

.tc-result-chip.result-draw {
  background: color-mix(in srgb, var(--text-mute) 18%, var(--surface));
  border-color: var(--text-mute);
  color: var(--text);
}

/* Cells promoted to filter buttons (click → narrow the set to that value). The
   reset is at specificity 0 (:where) so the result chip's own tint/border still
   wins; the bare map button gets a transparent bg + hover wash. */
:where(.tc-filter-cell) {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: pointer;
}
.tc-filter-cell:disabled { cursor: default; }
.tc-filter-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.tc-map .tc-filter-cell {
  padding: 0 0.25rem;
  margin-inline: -0.25rem;
  border-radius: 3px;
}
.tc-map .tc-filter-cell:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); }
.tc-result .tc-filter-cell:hover:not(:disabled) { filter: brightness(1.12); }

/* Mode / Queue cells are filter buttons now — give them padding + a hover wash. */
.tc-mode .tc-filter-cell,
.tc-queue .tc-filter-cell { padding: 0.05rem 0.3rem; border-radius: 3px; }

.tc-mode .tc-filter-cell:hover,
.tc-queue .tc-filter-cell:hover { background: color-mix(in srgb, var(--accent) 14%, transparent); }

/* Active filter — an accent outline (+ a soft fill on the non-result cells,
   which keep their result tint) so the live filters read at a glance. */
.tc-filter-cell.is-filtered { box-shadow: inset 0 0 0 1px var(--accent); border-radius: 3px; }
.tc-filter-cell.is-filtered:not(.tc-result-chip) { background: var(--accent-soft); }
</style>

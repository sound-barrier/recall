<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import { useOWData } from '@/composables/shared/useOWData'
import {
  formatHeroes,
  formatRoles,
  formatRowDate,
  formatFinishedAt,
  isEditedMatch,
  isHeroUnknown,
  isManualMatch,
  isMapUnknown,
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
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'toggle-select': [matchKey: string]
  'row-context': [event: MouseEvent, matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
}>()

const ow = useOWData()

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
    <td class="tc tc-date">
      <span class="tc-date-d">{{ formatRowDate(rec) }}</span>
      <span class="tc-date-t">{{ formatFinishedAt(rec) }}</span>
    </td>
    <td class="tc tc-map">
      <span
        v-if="isMapUnknown(rec)"
        class="tc-unknown"
        :title="`OCR read: ${rec.data?.map_raw ?? '—'}`"
      >{{ formatUnknownMapLabel(rec) }}</span>
      <HighlightedText v-else :text="rec.data?.map || 'unknown'" :terms="bareTerms" />
    </td>
    <td class="tc tc-mode">
      <span class="tc-chip">{{ formatPlayModeLabel(rec) }}</span>
    </td>
    <td class="tc tc-queue">
      <span class="tc-chip">{{ formatQueueTypeLabel(rec) }}</span>
    </td>
    <td class="tc tc-hero">
      <span
        v-if="isHeroUnknown(rec)"
        class="tc-unknown"
        :title="`OCR read: ${rec.data?.hero_raw ?? '—'}`"
      >{{ formatUnknownHeroLabel(rec) }}</span>
      <HighlightedText v-else :text="formatHeroes(rec)" :terms="bareTerms" />
    </td>
    <td class="tc tc-role">
      {{ formatRoles(rec, ow.heroRole) }}
    </td>
    <td class="tc tc-stat-cell tc-elim">
      {{ rec.data?.eliminations ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-assist">
      {{ rec.data?.assists ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-death">
      {{ rec.data?.deaths ?? '—' }}
    </td>
    <td class="tc tc-tags">
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
    <td class="tc tc-prov">
      <input
        type="checkbox"
        class="tc-prov-box"
        disabled
        :checked="isEditedMatch(rec)"
        :aria-label="isEditedMatch(rec) ? 'Edited after parsing' : 'Not edited'"
      >
    </td>
    <td class="tc tc-prov">
      <input
        type="checkbox"
        class="tc-prov-box"
        disabled
        :checked="isManualMatch(rec)"
        :aria-label="isManualMatch(rec) ? 'Hand-entered match' : 'Not hand-entered'"
      >
    </td>
    <td class="tc tc-result">
      <span class="tc-result-chip" :class="`result-${rec.data?.result || 'unknown'}`">{{ rec.data?.result || '—' }}</span>
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
.tc-check { width: 1.6rem; padding-right: 0; }

.tc-date { line-height: 1.15; }
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
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--identity-accent);
}
.tc-role { color: var(--text-faint); text-transform: uppercase; letter-spacing: 0.14em; font-size: 0.58rem; }

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
</style>

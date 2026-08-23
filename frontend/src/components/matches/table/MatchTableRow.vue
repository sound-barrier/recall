<script setup lang="ts">
import { computed } from 'vue'

import { useRowContext } from '@/composables/matches/useRowContext'

import type { MatchRecord } from '@/api-client'
import type { FilterableField } from '@/composables/matches/useNarrowCellFilter'
import { useMatchClock } from '@/composables/matches/useMatchClock'
import { useOWData } from '@/composables/shared/useOWData'
import {
  formatRowDate,
  formatFinishedAt,
  isHeroUnknown,
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
import { formatKda, kdaRatio } from '@/match/match-stats-helpers'
import { disruptionLabel, disruptionTint } from '@/match/dossier/match-disruption'
import { highlightTermsFor, type SearchClause } from '@/match/search-query'
import HighlightedText from '@/components/matches/shared/HighlightedText.vue'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

// One <tr> in the data-density match table. Carries the SAME props +
// emits as MatchLeafRow so MatchesView wires every interaction (click →
// detail, select, context-menu, hover-preview, anchor, j/k focus)
// identically; only the rendering differs — table cells, not a card
// grid. Reuses HighlightedText (the scoped-search highlight) on the
// free-text cells, and the shared .leaf-checkbox styling (app.css).
const { onRowContext } = useRowContext()

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
  'filter-cell': [field: FilterableField, value: string]
  'toggle-select': [matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
}>()

const ow = useOWData()

// A loaned coaching corpus prints the PLAYER's naive clock — the same one
// the row is grouped and filtered under (design rule 7).
const clock = useMatchClock()

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
const kda = computed(() => formatKda(kdaRatio(props.rec.data)))
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
    @contextmenu="onRowContext($event, rec.match_key)"
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
      <span class="tc-date-d">{{ formatRowDate(rec, clock) }}</span>
      <span class="tc-date-t">{{ formatFinishedAt(rec, clock) }}</span>
    </td>
    <td class="tc tc-result" :data-col="1" :class="{ 'is-cell-selected': sel(1) }">
      <button
        type="button"
        class="tc-result-chip tc-filter-cell"
        :class="[`result-${rec.data?.result || 'unknown'}`, { 'is-filtered': resultFiltered }]"
        :aria-pressed="resultFiltered ? 'true' : 'false'"
        :disabled="!rec.data?.result"
        :title="!rec.data?.result ? undefined : resultFiltered ? `Filtering by ${rec.data.result} — click to clear` : `Filter the set to ${rec.data.result}`"
        @click.stop="rec.data?.result && emit('filter-cell', 'result', rec.data.result)"
      >
        {{ rec.data?.result || '—' }}
      </button>
    </td>
    <td class="tc tc-map" :data-col="2" :class="{ 'is-cell-selected': sel(2) }">
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
        :aria-pressed="mapFiltered ? 'true' : 'false'"
        :title="mapFiltered ? `Filtering by ${rec.data?.map} — click to clear` : `Filter the set to ${rec.data?.map}`"
        @click.stop="emit('filter-cell', 'map', rec.data?.map ?? '')"
      >
        <HighlightedText :text="rec.data?.map || 'unknown'" :terms="bareTerms" />
      </button>
    </td>
    <td class="tc tc-mode" :data-col="3" :class="{ 'is-cell-selected': sel(3) }">
      <button
        type="button"
        class="tc-chip tc-filter-cell"
        :class="{ 'is-filtered': modeFiltered }"
        :aria-pressed="modeFiltered ? 'true' : 'false'"
        :title="modeFiltered ? `Filtering by ${formatPlayModeLabel(rec)} — click to clear` : `Filter the set to ${formatPlayModeLabel(rec)}`"
        @click.stop="emit('filter-cell', 'mode', playModePick)"
      >
        {{ formatPlayModeLabel(rec) }}
      </button>
    </td>
    <td class="tc tc-queue" :data-col="4" :class="{ 'is-cell-selected': sel(4) }">
      <button
        type="button"
        class="tc-chip tc-filter-cell"
        :class="{ 'is-filtered': queueFiltered }"
        :aria-pressed="queueFiltered ? 'true' : 'false'"
        :title="queueFiltered ? `Filtering by ${formatQueueTypeLabel(rec)} — click to clear` : `Filter the set to ${formatQueueTypeLabel(rec)}`"
        @click.stop="emit('filter-cell', 'queue', queuePick)"
      >
        {{ formatQueueTypeLabel(rec) }}
      </button>
    </td>
    <td class="tc tc-hero" :data-col="5" :class="{ 'is-cell-selected': sel(5) }">
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
    <td class="tc tc-role" :data-col="6" :class="{ 'is-cell-selected': sel(6) }">
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
    <td class="tc tc-stat-cell tc-elim" :data-col="7" :class="{ 'is-cell-selected': sel(7) }">
      {{ rec.data?.eliminations ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-assist" :data-col="8" :class="{ 'is-cell-selected': sel(8) }">
      {{ rec.data?.assists ?? '—' }}
    </td>
    <td class="tc tc-stat-cell tc-death" :data-col="9" :class="{ 'is-cell-selected': sel(9) }">
      {{ rec.data?.deaths ?? '—' }}
    </td>
    <!-- The derived (E+A)/D cell names itself: several columns render a bare
         em-dash for missing data, so the number alone doesn't say what it is. -->
    <td
      class="tc tc-stat-cell tc-kda"
      :data-col="10"
      :class="{ 'is-cell-selected': sel(10) }"
      :aria-label="kda ? `KDA ${kda}` : 'KDA unavailable'"
    >
      {{ kda || '—' }}
    </td>
    <td class="tc tc-tags" :data-col="11" :class="{ 'is-cell-selected': sel(11) }">
      <span
        v-if="rec.annotation?.leavers?.length"
        role="img"
        class="tc-stamp"
        :class="`stamp-${disruptionTint(rec.annotation.leavers)}`"
        :aria-label="disruptionLabel('leavers', rec.annotation.leavers)"
        :title="disruptionLabel('leavers', rec.annotation.leavers)"
      >L</span>
      <span
        v-if="rec.annotation?.throwers?.length"
        role="img"
        class="tc-stamp"
        :class="`stamp-${disruptionTint(rec.annotation.throwers)}`"
        :aria-label="disruptionLabel('throwers', rec.annotation.throwers)"
        :title="disruptionLabel('throwers', rec.annotation.throwers)"
      >T</span>
      <span
        v-for="t in rec.annotation?.tags ?? []"
        :key="t"
        class="tc-tag"
      >#<HighlightedText :text="t" :terms="tagTerms" /></span>
    </td>
    <td class="tc tc-prov" :data-col="12" :class="{ 'is-cell-selected': sel(12) }">
      <MatchProvenanceBadge :source="rec.source" :edited-fields="rec.edited_fields" compact />
    </td>
  </tr>
</template>

<style scoped src="./match-table-row.css"></style>

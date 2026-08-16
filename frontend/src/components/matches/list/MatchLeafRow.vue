<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
import { useMatchClock } from '@/composables/shared/useMatchClock'
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
import { disruptionLabel, disruptionTint } from '@/match/match-disruption'
import { highlightTermsFor, type SearchClause } from '@/match/search-query'
import HighlightedText from '@/components/matches/shared/HighlightedText.vue'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

// One compact match row in the set's members list. Click opens the
// detail panel; the row carries data-match-key / data-card-index /
// aria-current so App.vue's j/k keyboard nav + the e2e suite can target
// it. Selection / anchor / focus state is parent-owned (MatchesView);
// the row reflects it via props and signals intent via emits. The
// .leaf-checkbox styling is shared with the archive row, so it lives in
// app.css (the >1-component rule).
const props = defineProps<{
  rec: MatchRecord
  // Position in the narrowed set — drives data-card-index and the
  // keyboard-focus match. -1 when the row isn't in the current narrow.
  cardIndex: number
  // App.vue's j/k focus index; the matching row gets aria-current +
  // .kbd-focused.
  focusedCardIndex?: number
  selected: boolean      // ticked in the contextual multi-select
  hasSelection: boolean  // ANY row in the section is ticked
  isAnchor: boolean      // the current "since this match" anchor
  // Parsed narrow-search clauses — drives highlighting of matched
  // substrings in the visible free-text surfaces (map / hero / tags).
  searchClauses: SearchClause[]
  // The active narrow picks — a value cell whose value is in its set renders as
  // an active filter (every value cell filters; sorting is the toolbar's job).
  activeFilters?: {
    maps: ReadonlySet<string>
    modes: ReadonlySet<string>
    queues: ReadonlySet<string>
    heroes: ReadonlySet<string>
    roles: ReadonlySet<string>
    results: ReadonlySet<string>
  }
}>()

const emit = defineEmits<{
  'open-match': [matchKey: string]
  'filter-cell': [field: 'map' | 'mode' | 'queue' | 'hero' | 'role' | 'result', value: string]
  'toggle-select': [matchKey: string]
  'row-context': [event: MouseEvent, matchKey: string]
  'hover-enter': [rec: MatchRecord, event: MouseEvent]
  'hover-move': [event: MouseEvent]
  'hover-leave': []
}>()

const ow = useOWData()

// A loaned coaching corpus prints the PLAYER's naive clock — the same one
// the row is grouped and filtered under (design rule 7).
const clock = useMatchClock()

const isFocused = computed(
  () => props.focusedCardIndex !== undefined && props.cardIndex === props.focusedCardIndex,
)

// Bare clauses match (and so highlight) the plain surfaces — map, hero.
// The tag surface additionally honors `tag:`-scoped clauses.
const bareTerms = computed(() => props.searchClauses.filter((c) => c.field === null).map((c) => c.value))
const tagTerms = computed(() => highlightTermsFor('tag', props.searchClauses))

// Click-to-filter pick values for the mode + queue chips (the narrow's
// PlayModePick / QueuePick unions), derived the same way the labels are.
const playModePick = computed(() => {
  const m = props.rec.play_mode ?? props.rec.data?.playlist
  return m === 'quickplay' || m === 'competitive' ? m : 'unknown'
})
const queuePick = computed(() => {
  const q = props.rec.queue_type
  return q === 'role' || q === 'open' ? q : 'unknown'
})

// Whether each cell's value is currently an active narrow filter (lights it up).
const mapFiltered = computed(() => props.activeFilters?.maps.has(props.rec.data?.map ?? '') ?? false)
const modeFiltered = computed(() => props.activeFilters?.modes.has(playModePick.value) ?? false)
const queueFiltered = computed(() => props.activeFilters?.queues.has(queuePick.value) ?? false)
const heroFiltered = (hero: string) => props.activeFilters?.heroes.has(hero) ?? false
const roleFiltered = (role: string) => props.activeFilters?.roles.has(role) ?? false
const resultFiltered = computed(() => props.activeFilters?.results.has(props.rec.data?.result ?? '') ?? false)
</script>

<template>
  <li
    class="leaf-row"
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
    <!-- Anchor indicator — a small filled-diamond glyph that shows when
         this row is the "since this match" anchor. Sits in the absolute
         corner so it doesn't push other cells. The .is-anchor class on
         the row also adds a left-edge accent stripe. -->
    <span
      v-if="isAnchor"
      class="leaf-anchor-pin"
      aria-label="Current “since” anchor"
      title="This match is the current “since” anchor."
      data-leaf-anchor-pin
    >◆</span>
    <!-- Contextual checkbox — always in the DOM so the row geometry
         never jumps. Visually faint when idle, full-opacity on row
         hover / focus / when ticked / when ANY row is ticked. Click
         stops propagation so the row still opens the detail panel on
         body click. -->
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

    <!-- 1. Result-tinted color strip — instant scan target. -->
    <button
      type="button"
      class="leaf-strip"
      :class="{ 'is-filtered': resultFiltered }"
      :aria-pressed="resultFiltered ? 'true' : 'false'"
      :disabled="!rec.data?.result"
      :title="!rec.data?.result ? undefined : resultFiltered ? `Filtering by ${rec.data.result} — click to clear` : `Filter the set to ${rec.data.result}`"
      :aria-label="rec.data?.result ? `Filter by ${rec.data.result}` : 'Result'"
      @click.stop="rec.data?.result && emit('filter-cell', 'result', rec.data.result)"
    />

    <!-- 2. When — date over time. -->
    <div class="leaf-when">
      <span class="leaf-when-date">{{ formatRowDate(rec, clock) }}</span>
      <span class="leaf-when-time">{{ formatFinishedAt(rec, clock) }}</span>
    </div>

    <!-- 3. Where — map (display font) over a pair of chips: play mode
         (Quickplay / Competitive / Unknown mode) + queue type (Role
         Queue / Open Queue / Unknown mode type). Both chips always
         render so a glance down the column stays aligned even when the
         underlying field hasn't been set yet. -->
    <div class="leaf-map-block">
      <span
        v-if="isMapUnknown(rec)"
        class="leaf-map leaf-map-unknown"
        :data-unknown-map="rec.data?.map_raw || true"
        :title="`The parser couldn't match the OCR'd map text to maps.yaml. Wait for the next release to recognize it. (OCR read: ${rec.data?.map_raw ?? '—'})`"
      >{{ formatUnknownMapLabel(rec) }}</span>
      <button
        v-else
        type="button"
        class="leaf-map leaf-filter-cell"
        :class="{ 'is-filtered': mapFiltered }"
        :aria-pressed="mapFiltered ? 'true' : 'false'"
        :title="mapFiltered ? `Filtering by ${rec.data?.map} — click to clear` : `Filter the set to ${rec.data?.map}`"
        @click.stop="emit('filter-cell', 'map', rec.data?.map ?? '')"
      >
        <HighlightedText :text="rec.data?.map || 'unknown'" :terms="bareTerms" />
      </button>
      <span class="leaf-mode-row">
        <button
          type="button"
          class="leaf-mode-chip leaf-filter-cell"
          :class="{ 'is-filtered': modeFiltered }"
          :aria-pressed="modeFiltered ? 'true' : 'false'"
          :title="modeFiltered ? `Filtering by ${formatPlayModeLabel(rec)} — click to clear` : `Filter the set to ${formatPlayModeLabel(rec)}`"
          @click.stop="emit('filter-cell', 'mode', playModePick)"
        >{{ formatPlayModeLabel(rec) }}</button>
        <button
          type="button"
          class="leaf-queue-chip leaf-filter-cell"
          :class="{ 'is-filtered': queueFiltered }"
          :aria-pressed="queueFiltered ? 'true' : 'false'"
          :title="queueFiltered ? `Filtering by ${formatQueueTypeLabel(rec)} — click to clear` : `Filter the set to ${formatQueueTypeLabel(rec)}`"
          @click.stop="emit('filter-cell', 'queue', queuePick)"
        >{{ formatQueueTypeLabel(rec) }}</button>
      </span>
    </div>

    <!-- 4. Who — hero over role. Open-queue matches can mix support /
         tank / dps in one game; formatRoles lists every role the
         heroes_played array resolved to in percent-played order,
         deduped. Unknown heroes (OCR captured but no canonical match in
         heroes.yaml) get a warning-styled chip with the raw OCR in
         parens. -->
    <div class="leaf-hero-block">
      <span
        v-if="isHeroUnknown(rec)"
        class="leaf-hero leaf-hero-unknown"
        :data-unknown-hero="rec.data?.hero_raw || true"
        :title="`The parser couldn't match the OCR'd hero text to heroes.yaml. Wait for the next release to recognize it. (OCR read: ${rec.data?.hero_raw ?? '—'})`"
      >{{ formatUnknownHeroLabel(rec) }}</span>
      <span v-else class="leaf-hero">
        <button
          v-for="h in sortedHeroPlays(rec)"
          :key="h.hero"
          type="button"
          class="leaf-hero-chip leaf-filter-cell"
          :class="{ 'is-filtered': heroFiltered(h.hero) }"
          :aria-pressed="heroFiltered(h.hero) ? 'true' : 'false'"
          :title="heroFiltered(h.hero) ? `Filtering by ${h.hero} — click to clear` : `Filter the set to ${h.hero}`"
          @click.stop="emit('filter-cell', 'hero', h.hero)"
        ><HighlightedText :text="h.hero" :terms="bareTerms" /></button>
      </span>
      <span v-if="rolePlays(rec, ow.heroRole).length" class="leaf-role">
        <button
          v-for="r in rolePlays(rec, ow.heroRole)"
          :key="r.role"
          type="button"
          class="leaf-role-chip leaf-filter-cell"
          :class="{ 'is-filtered': roleFiltered(r.role) }"
          :aria-pressed="roleFiltered(r.role) ? 'true' : 'false'"
          :title="roleFiltered(r.role) ? `Filtering by ${r.role} — click to clear` : `Filter the set to ${r.role}`"
          @click.stop="emit('filter-cell', 'role', r.role)"
        >{{ r.role }}</button>
      </span>
    </div>

    <!-- 5. How — eliminations / assists / deaths, big + bold. -->
    <div class="leaf-stats-block" :aria-label="`Eliminations ${rec.data?.eliminations ?? '?'}, assists ${rec.data?.assists ?? '?'}, deaths ${rec.data?.deaths ?? '?'}`">
      <span class="stat-num">{{ rec.data?.eliminations ?? '—' }}</span>
      <span class="stat-sep" aria-hidden="true">/</span>
      <span class="stat-num">{{ rec.data?.assists ?? '—' }}</span>
      <span class="stat-sep" aria-hidden="true">/</span>
      <span class="stat-num stat-deaths">{{ rec.data?.deaths ?? '—' }}</span>
    </div>

    <!-- 6. Annotations — provenance + disruption stamps + tags. Empty when none. -->
    <div class="leaf-meta-block">
      <span v-if="rec.pinned" class="leaf-pin" title="Pinned match" aria-label="Pinned">★</span>
      <MatchProvenanceBadge :source="rec.source" :edited-fields="rec.edited_fields" compact />
      <span
        v-if="rec.annotation?.leavers?.length"
        role="img"
        class="leaf-stamp"
        :class="`stamp-${disruptionTint(rec.annotation.leavers)}`"
        :aria-label="disruptionLabel('leavers', rec.annotation.leavers)"
        :title="disruptionLabel('leavers', rec.annotation.leavers)"
      >L</span>
      <span
        v-if="rec.annotation?.throwers?.length"
        role="img"
        class="leaf-stamp"
        :class="`stamp-${disruptionTint(rec.annotation.throwers)}`"
        :aria-label="disruptionLabel('throwers', rec.annotation.throwers)"
        :title="disruptionLabel('throwers', rec.annotation.throwers)"
      >T</span>
      <span
        v-for="t in rec.annotation?.tags ?? []"
        :key="t"
        class="leaf-tag"
      >#<HighlightedText :text="t" :terms="tagTerms" /></span>
    </div>

    <!-- 7. Outcome chip — anchored to the right edge. -->
    <span class="leaf-result-chip" :class="`result-${rec.data?.result || 'unknown'}`">
      {{ rec.data?.result || '—' }}
    </span>
  </li>
</template>

<style scoped src="./match-leaf-row.css"></style>

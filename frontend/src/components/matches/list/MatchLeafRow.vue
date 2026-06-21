<script setup lang="ts">
import { computed } from 'vue'
import type { MatchRecord } from '@/api-client'
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

const isFocused = computed(
  () => props.focusedCardIndex !== undefined && props.cardIndex === props.focusedCardIndex,
)

// Bare clauses match (and so highlight) the plain surfaces — map, hero.
// The tag surface additionally honours `tag:`-scoped clauses.
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
      :disabled="!rec.data?.result"
      :title="!rec.data?.result ? undefined : resultFiltered ? `Filtering by ${rec.data.result} — click to clear` : `Filter the set to ${rec.data.result}`"
      :aria-label="rec.data?.result ? `Filter by ${rec.data.result}` : 'Result'"
      @click.stop="rec.data?.result && emit('filter-cell', 'result', rec.data.result)"
    />

    <!-- 2. When — date over time. -->
    <div class="leaf-when">
      <span class="leaf-when-date">{{ formatRowDate(rec) }}</span>
      <span class="leaf-when-time">{{ formatFinishedAt(rec) }}</span>
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
        :title="`The parser couldn't match the OCR'd map text to maps.yaml. Wait for the next release to recognise it. (OCR read: ${rec.data?.map_raw ?? '—'})`"
      >{{ formatUnknownMapLabel(rec) }}</span>
      <button
        v-else
        type="button"
        class="leaf-map leaf-filter-cell"
        :class="{ 'is-filtered': mapFiltered }"
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
          :title="modeFiltered ? `Filtering by ${formatPlayModeLabel(rec)} — click to clear` : `Filter the set to ${formatPlayModeLabel(rec)}`"
          @click.stop="emit('filter-cell', 'mode', playModePick)"
        >{{ formatPlayModeLabel(rec) }}</button>
        <button
          type="button"
          class="leaf-queue-chip leaf-filter-cell"
          :class="{ 'is-filtered': queueFiltered }"
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
        :title="`The parser couldn't match the OCR'd hero text to heroes.yaml. Wait for the next release to recognise it. (OCR read: ${rec.data?.hero_raw ?? '—'})`"
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

    <!-- 6. Annotations — provenance + leaver + tags. Empty when none. -->
    <div class="leaf-meta-block">
      <MatchProvenanceBadge :source="rec.source" :edited-fields="rec.edited_fields" compact />
      <span v-if="rec.annotation?.leaver" class="leaf-leaver" :title="`Leaver: ${rec.annotation.leaver}`">L</span>
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

<style scoped>
/* Seven-cell grid with fixed children per row — every leaf-row
   produces exactly seven DOM children so the grid never overflows
   into implicit columns (the cause of the "17 next to victory" bug
   where tag/leaver spans pushed the stats + result chip into
   adjacent cells). Sub-containers stack their own content
   internally with flex. */
.leaf-row {
  display: grid;

  /* Eight columns: contextual checkbox at the head, then the original
     seven. The checkbox column is fixed-width so its appearance never
     shifts the rest of the row when its opacity ramps up. */
  grid-template-columns:
    1.1rem               /* checkbox — always reserved, opacity-driven */
    4px                  /* strip */
    72px                 /* when */
    minmax(0, 1.4fr)     /* map block */
    minmax(0, 1fr)       /* hero block */
    7rem                 /* stats — fixed so hero left edge aligns */
    minmax(0, 1fr)       /* meta */
    6rem;                /* result chip — match the chip's own width */

  gap: 0.85rem;
  align-items: center;
  padding: 0.55rem 0.85rem;
  border: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
  background: var(--surface);
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
}

.leaf-row:hover {
  background: color-mix(in srgb, var(--accent) 6%, var(--surface));
  border-color: var(--accent-soft);
}

.leaf-strip {
  appearance: none;
  border: 0;
  padding: 0;
  width: 4px; height: 36px;
  background: var(--text-faint);
  border-radius: 2px;
  cursor: pointer;
  transition: width 100ms ease, box-shadow 120ms ease;
}
.leaf-strip:disabled { cursor: default; }
.leaf-strip:hover:not(:disabled) { width: 6px; }
.leaf-strip:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.leaf-strip.is-filtered { width: 6px; box-shadow: 0 0 0 1px var(--accent); }
.leaf-row.result-victory .leaf-strip { background: var(--win); }
.leaf-row.result-defeat  .leaf-strip { background: var(--loss); }
.leaf-row.result-draw    .leaf-strip { background: var(--draw, var(--text-mute)); }

/* Anchor row treatment — a left-edge accent stripe + a faint accent
   wash so users scanning the list can find their "since" match at a
   glance. The diamond glyph sits absolute in the row's top-right
   corner where it never collides with stats / result chips. */
.leaf-row.is-anchor {
  position: relative;
  border-color: color-mix(in srgb, var(--accent) 45%, var(--border));
  box-shadow: inset 3px 0 0 0 var(--accent);
}

.leaf-row.is-anchor:hover {
  background: color-mix(in srgb, var(--accent) 9%, var(--surface));
}

.leaf-anchor-pin {
  position: absolute;
  top: 0.35rem;
  right: 0.5rem;
  font-size: 0.7rem;
  line-height: 1;
  color: var(--accent);
  pointer-events: auto;
  cursor: help;
}

/* 2. When — date stacked over time. */
.leaf-when {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  line-height: 1;
}

.leaf-when-date {
  color: var(--text);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.04em;
}

.leaf-when-time {
  color: var(--text-faint);
  font-size: 0.6rem;
  letter-spacing: 0.02em;
}

/* 3. Where — map title + mode chip. */
.leaf-map-block {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

/* The map / mode / queue cells are filter buttons (click to narrow the set).
   Reset the button chrome at 0 specificity so each keeps its own look; brighten
   on hover as the clickable cue. */
:where(.leaf-filter-cell) {
  appearance: none;
  border: 0;
  background: none;
  padding: 0;
  font: inherit;
  color: inherit;
  text-align: inherit;
  cursor: pointer;
}
.leaf-filter-cell { border-radius: 3px; }
.leaf-filter-cell:hover { filter: brightness(1.12); }
.leaf-filter-cell:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* A funnel glyph marks these as FILTERS — the sort pivots (hero/role) have none.
   Faint on hover, lit when the value is the active filter. */
.leaf-filter-cell::after {
  content: '';
  display: inline-block;
  width: 0.62em;
  height: 0.62em;
  margin-left: 0.22em;
  vertical-align: -0.05em;
  background-color: currentcolor;
  mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='M2 3h12l-4.5 5.5V13l-3 1.5V8.5z'/%3E%3C/svg%3E") no-repeat center / contain;
  opacity: 0;
  transition: opacity 120ms ease;
}

.leaf-filter-cell:hover::after,
.leaf-filter-cell.is-filtered::after { opacity: 0.7; }

/* Active filter — soft/outlined accent, deliberately distinct from the sort
   pivots' FILLED accent so "filter" never reads as "sort". */
.leaf-filter-cell.is-filtered {
  background: var(--accent-soft);
  box-shadow: inset 0 0 0 1px var(--accent);
}

.leaf-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 1.1rem;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  color: var(--identity-accent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1;
}

/* Unknown-hero / Unknown-map warning variant. Same shape as the
   canonical leaf-hero / leaf-map but coloured with the accent —
   draws the eye to "this matched nothing in the YAML; an update
   is needed". The :title attribute carries the OCR'd text + the
   "wait for the next release" copy so a hover gives the full
   context without crowding the leaf row. */
.leaf-hero-unknown,
.leaf-map-unknown {
  color: var(--accent-bright, var(--accent));
  cursor: help;
}

.leaf-mode-row {
  display: inline-flex;
  gap: 0.25rem;
}

.leaf-mode-chip,
.leaf-queue-chip {
  font-family: var(--mono);
  font-size: 0.52rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--surface-2);
  line-height: 1;
}

/* 4. Who — hero name + role label. */
.leaf-hero-block {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
}

.leaf-hero {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 1px 2px;
  min-width: 0;
  line-height: 1;
}

/* Each hero is a clickable pivot chip — click sorts that hero's matches to the
   top of each section; the active one renders filled. Resets the button's UA
   chrome and inherits the hero-name look. */
.leaf-hero-chip {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0.05rem 0.2rem;
  font-family: var(--mono);
  font-size: 0.85rem;
  font-weight: 700;
  color: var(--identity-accent);
  text-transform: lowercase;
  line-height: 1;
  border-radius: 2px;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}
.leaf-hero-chip:hover { background: color-mix(in srgb, var(--identity-accent) 18%, transparent); }
.leaf-hero-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

.leaf-role {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 1px 3px;
}

/* Each role is a clickable filter chip (open-queue matches show several). Keeps
   the faint uppercase mono look. */
.leaf-role-chip {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 0 0.2rem;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 600;
  cursor: pointer;
  border-radius: 2px;
  transition: background 120ms ease, color 120ms ease;
}
.leaf-role-chip:hover { background: color-mix(in srgb, var(--accent) 16%, transparent); color: var(--text); }
.leaf-role-chip:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

/* 5. How — E/A/D, big bold tabular numerals with thin separators. */
.leaf-stats-block {
  display: inline-flex;
  align-items: baseline;
  gap: 0;
  font-family: var(--mono);
  font-feature-settings: "tnum";
  white-space: nowrap;
  padding: 0 0.3rem;
}

.stat-num {
  font-size: 1rem;
  font-weight: 700;
  color: var(--text);
  min-width: 1.1ch;
  text-align: center;
}
.stat-num.stat-deaths { color: var(--text-dim); }

.stat-sep {
  color: var(--text-faint);
  font-size: 0.85rem;
  padding: 0 0.25rem;
  font-weight: 400;
}

/* 6. Annotations — tags + leaver. Always renders (may be empty). */
.leaf-meta-block {
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  align-items: center;
  min-width: 0;
}

.leaf-tag {
  font-family: var(--mono);
  font-size: 0.58rem;
  padding: 0.12rem 0.36rem;
  border: 1px solid var(--accent-soft);
  border-radius: 2px;
  color: var(--accent);
  letter-spacing: 0.04em;
  text-transform: lowercase;
  white-space: nowrap;
}

.leaf-leaver {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 800;
  padding: 0.1rem 0.4rem;
  border: 1px solid var(--loss);
  color: var(--loss);
  background: color-mix(in srgb, var(--loss) 12%, transparent);
  border-radius: 2px;
  letter-spacing: 0.14em;
}

.leaf-result-chip {
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.32rem 0.85rem;
  border-radius: 2px;
  font-weight: 800;
  border: 1px solid var(--border);
  background: var(--surface-2);
  color: var(--text-faint);

  /* Fixed width — VICTORY (7 chars + letter-spacing) was outgrowing
     the 5rem min-width and pushing the chip wider than DEFEAT / DRAW
     so the result column lost its vertical alignment across rows.
     6rem fits the longest label comfortably and the rest center inside
     it. (Global box-sizing: border-box means width includes padding +
     border.) */
  width: 6rem;
  text-align: center;
  line-height: 1;
}

.leaf-result-chip.result-victory {
  background: color-mix(in srgb, var(--win) 22%, var(--surface));
  border-color: var(--win-line, var(--win));
  color: var(--win);
}

.leaf-result-chip.result-defeat {
  background: color-mix(in srgb, var(--loss) 22%, var(--surface));
  border-color: var(--loss-line, var(--loss));
  color: var(--loss);
}

.leaf-result-chip.result-draw {
  background: color-mix(in srgb, var(--text-mute) 18%, var(--surface));
  border-color: var(--text-mute);
  color: var(--text);
}

.leaf-row.is-ticked {
  background: color-mix(in srgb, var(--accent) 14%, var(--surface));
  outline: 1px solid var(--accent);
}
</style>

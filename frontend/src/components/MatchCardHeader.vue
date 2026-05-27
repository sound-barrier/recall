<script setup lang="ts">
import type { MatchRecord } from '../api'
import {
  fmtTime,
  heroesForHeader,
  missingRequiredSlots,
} from '../match-helpers'
import { useOWData } from '../composables/useOWData'

// Always-visible header for one match card. Owns the title row
// (index + map + time + length + chev), the tag row (mode / type /
// role / heroes / result / leaver / note / incomplete / compact
// stats), and every style that goes with it. Wired bottom-up:
// emits `toggle-expand` for the chev or any header-row click, and
// `filter-toggle` when a chip is clicked.
//
// Extracted from MatchCard.vue so the collapsed-view markup can
// live alongside its own ~360 lines of scoped CSS. The expanded
// view + the danger-row live in their own sibling components.

const ow = useOWData()

defineProps<{
  record: MatchRecord
  index: number
  isExpanded: boolean
  isActive: (field: string, value: string) => boolean
  // 'compact' tightens card padding + map font and inlines a small
  // E/A/D + damage strip in the tag-row so high-volume players see
  // at-a-glance stats without expanding every match. Optional so
  // existing tests can omit it; defaults to 'comfortable' behaviour.
  densityMode?: 'comfortable' | 'compact'
}>()

const emit = defineEmits<{
  'toggle-expand': []
  'filter-toggle': [field: string, value: string]
}>()
</script>

<template>
  <!-- Header is a mouse-clickable region for convenience, but the
       keyboard affordance for expand/collapse is the chev button on
       the right. Nested interactive elements (chip buttons inside a
       header button) are invalid HTML / ARIA, so the outer div
       intentionally has no role or tabindex. -->
  <div
    class="match-header"
    @click="emit('toggle-expand')"
  >
    <div class="match-title-row">
      <div class="match-title-lhs">
        <span class="match-index">{{ String(index + 1).padStart(2, '0') }}</span>
        <button
          type="button"
          class="match-map clickable"
          :class="{ active: isActive('map', record.data?.map ?? '') }"
          :aria-label="`Filter by map: ${ow.mapDisplayName(record.data?.map) || 'Unknown Map'}`"
          :aria-pressed="isActive('map', record.data?.map ?? '')"
          @click.stop="emit('filter-toggle', 'map', record.data?.map ?? '')"
        >
          {{ ow.mapDisplayName(record.data?.map) || 'Unknown Map' }}
        </button>
      </div>
      <div class="match-title-rhs">
        <span v-if="fmtTime(record)" class="when">{{ fmtTime(record) }}</span>
        <span v-if="record.data?.game_length" class="length"><span class="length-mark">▮</span>{{ record.data.game_length }}</span>
        <button
          type="button"
          class="chev chev-btn"
          :class="{ open: isExpanded }"
          :aria-expanded="isExpanded"
          :aria-label="`${ow.mapDisplayName(record.data?.map) || 'Unknown map'} — ${isExpanded ? 'collapse' : 'expand'} match details`"
          @click.stop="emit('toggle-expand')"
        >
          ›
        </button>
      </div>
    </div>

    <div class="match-tag-row">
      <button
        v-if="record.data?.mode"
        type="button"
        class="badge mode clickable"
        :class="{ active: isActive('mode', record.data.mode) }"
        :aria-label="`Filter by mode: ${record.data.mode}`"
        :aria-pressed="isActive('mode', record.data.mode)"
        @click.stop="emit('filter-toggle', 'mode', record.data.mode)"
      >
        {{ record.data.mode }}
      </button>
      <button
        v-if="record.data?.type"
        type="button"
        class="badge type clickable"
        :class="{ active: isActive('type', record.data.type) }"
        :aria-label="`Filter by game type: ${record.data.type}`"
        :aria-pressed="isActive('type', record.data.type)"
        @click.stop="emit('filter-toggle', 'type', record.data.type)"
      >
        {{ record.data.type }}
      </button>
      <button
        v-if="record.data?.role"
        type="button"
        class="badge role clickable"
        :class="[record.data.role, { active: isActive('role', record.data.role) }]"
        :aria-label="`Filter by role: ${record.data.role}`"
        :aria-pressed="isActive('role', record.data.role)"
        @click.stop="emit('filter-toggle', 'role', record.data.role)"
      >
        {{ record.data.role }}
      </button>
      <template v-for="hp in heroesForHeader(record)" :key="hp.hero">
        <button
          type="button"
          class="badge hero clickable"
          :class="{ active: isActive('hero', hp.hero) }"
          :aria-label="hp.percent_played != null ? `Filter by hero: ${ow.heroDisplayName(hp.hero)}, ${hp.percent_played}% played` : `Filter by hero: ${ow.heroDisplayName(hp.hero)}`"
          :aria-pressed="isActive('hero', hp.hero)"
          @click.stop="emit('filter-toggle', 'hero', hp.hero)"
        >
          <span class="hero-name-inline">{{ ow.heroDisplayName(hp.hero) }}</span>
          <span v-if="hp.percent_played != null" class="hero-pct-inline">{{ hp.percent_played }}%</span>
        </button>
      </template>
      <button
        v-if="record.data?.result"
        type="button"
        class="badge result clickable"
        :class="[record.data.result, { active: isActive('result', record.data.result) }]"
        :aria-label="`Filter by result: ${record.data.result}`"
        :aria-pressed="isActive('result', record.data.result)"
        @click.stop="emit('filter-toggle', 'result', record.data.result)"
      >
        {{ record.data.result }}
      </button>

      <!-- Leaver-mark — only renders when the user has annotated
           this match. Glyph is a single uppercase L in a circle
           (mono, tactical-readout feel). Carries the leaver-type
           in the title attribute so a hover reveals which side
           had the leaver. Not a button — the chooser lives in
           the expanded view to keep the collapsed header clean. -->
      <span
        v-if="record.annotation?.leaver"
        class="leaver-mark"
        :class="`leaver-${record.annotation.leaver}`"
        role="img"
        :title="record.annotation.leaver === 'self' ? 'You left this match (data incomplete)'
          : record.annotation.leaver === 'team' ? 'An ally left this match'
            : 'An enemy left this match'"
        :aria-label="record.annotation.leaver === 'self' ? 'You left this match'
          : record.annotation.leaver === 'team' ? 'An ally left this match'
            : 'An enemy left this match'"
      >
        <span class="leaver-mark-l" aria-hidden="true">L</span>
      </span>

      <!-- Note-present mark. Surfaces when the user has saved any
           of note / replay_code / members — same pill footprint as
           the leaver mark, accent-tinted instead of result-tinted.
           Tooltip echoes which fields are populated. -->
      <span
        v-if="record.annotation && (record.annotation.note || record.annotation.replay_code || (record.annotation.members && record.annotation.members.length))"
        class="note-mark"
        role="img"
        :title="[
          record.annotation.note ? 'has note' : '',
          record.annotation.replay_code ? 'replay: ' + record.annotation.replay_code : '',
          (record.annotation.members && record.annotation.members.length) ? (record.annotation.members.length + ' group member' + (record.annotation.members.length === 1 ? '' : 's')) : '',
        ].filter(Boolean).join(' · ')"
        aria-label="Match has user notes"
      >
        <span class="note-mark-glyph" aria-hidden="true">N</span>
      </span>

      <!-- Tag chips. Render the actual tag labels inline so a
           horizontal scan reveals which matches are stacks,
           streams, placements, or carry custom user labels.
           Same `.match-tag` chip class as the inline editor. -->
      <span
        v-if="record.annotation?.tags && record.annotation.tags.length"
        class="match-tags-row"
        :aria-label="`Tagged: ${record.annotation.tags.join(', ')}`"
      >
        <span
          v-for="t in record.annotation.tags"
          :key="t"
          class="match-tag"
          :data-tag="t"
        >
          <span class="match-tag-mark" aria-hidden="true" />
          <span class="match-tag-text">{{ t }}</span>
        </span>
      </span>
      <span
        v-if="missingRequiredSlots(record).length"
        class="incomplete-badge"
        :title="`Incomplete match — missing ${missingRequiredSlots(record).map(s => s.label).join(', ')} screenshot${missingRequiredSlots(record).length === 1 ? '' : 's'}. Expand for details.`"
      >
        <span class="incomplete-glyph" aria-hidden="true">!</span>
        <span class="incomplete-text">missing <strong>{{ missingRequiredSlots(record).map(s => s.label).join(' · ') }}</strong></span>
      </span>

      <!-- Compact-mode inline stats. Only renders when density is
           'compact' AND at least one of E/A/D/damage exists. Sits
           at the far-right of the tag-row so a horizontal scan
           picks up "what did I do this match" without expanding.
           Mono digits + tabular figures keep columns from jittering
           across cards. -->
      <span
        v-if="densityMode === 'compact' && (record.data?.eliminations != null || record.data?.assists != null || record.data?.deaths != null || record.data?.damage != null)"
        class="compact-stats"
        aria-label="Match stats at a glance"
      >
        <span class="compact-ead">
          <span>{{ record.data?.eliminations ?? '—' }}</span><span class="compact-sep">/</span><span>{{ record.data?.assists ?? '—' }}</span><span class="compact-sep">/</span><span>{{ record.data?.deaths ?? '—' }}</span>
        </span>
        <span v-if="record.data?.damage != null" class="compact-dmg">{{ record.data.damage.toLocaleString() }}<span class="compact-unit">dmg</span></span>
      </span>
    </div>
  </div>
</template>

<style scoped>
.match-header {
  cursor: pointer;
  user-select: none;
  border-radius: 2px;
}

/* Strip browser button chrome on the chip buttons inside the
   header. :where() keeps specificity at 0 so existing .badge /
   .match-map rules continue to win. */
:where(
  button.match-map,
  button.badge,
  button.chev-btn
) {
  appearance: none;
  background: transparent;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  padding: 0;
  margin: 0;
  text-align: inherit;
}

.match-map.clickable:focus-visible,
.badge.clickable:focus-visible,
.chev-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* The chev is the keyboard expand affordance — give it a real hit
   target so taps/clicks aren't strictly on the glyph. */
button.chev-btn {
  padding: 0.15rem 0.3rem;
  border-radius: 2px;
}

button.chev-btn:hover { color: var(--accent-bright); }

.match-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  margin-bottom: 0.55rem;
}

.match-title-lhs {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  min-width: 0;
}

.match-index {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-mute);
  letter-spacing: 0.06em;
  font-feature-settings: "tnum";
}

.match-map {
  font-family: var(--display);
  font-style: italic;
  font-weight: 800;
  font-size: 1.55rem;
  letter-spacing: 0.005em;
  color: var(--text);
  text-transform: uppercase;
  padding: 0 0.15rem;
  position: relative;
  transition: color 160ms ease, text-shadow 200ms ease;
}

.match-map:hover {
  color: var(--accent-bright);
  text-shadow: 0 0 24px var(--accent-glow);
}

.match-map.active {
  color: var(--accent);
  text-shadow: 0 0 18px var(--accent-glow);
}

.match-title-rhs {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

.when {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text-dim);
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

.length-mark {
  color: var(--accent);
  font-size: 0.55rem;
  opacity: 0.7;
}

.match-tag-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  align-items: center;
}

.hero-name-inline {
  font-family: var(--display);
  font-style: italic;
  font-weight: 700;
  font-size: 0.95rem;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

.hero-pct-inline {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--accent-text);
  opacity: 0.75;
  font-weight: 500;
  font-feature-settings: "tnum";
  letter-spacing: 0;
}

/* ─── Incomplete-match warning pill ──────────────────────── */

.incomplete-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.18rem 0.55rem 0.18rem 0.4rem;
  margin-left: auto;
  background: rgb(245 166 35 / 8%);
  border: 1px dashed rgb(245 166 35 / 55%);
  border-radius: 2px;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-bright);
  cursor: help;
  animation: incomplete-pulse 2.6s ease-in-out infinite;
}

.incomplete-badge strong {
  font-weight: 700;
  color: var(--accent-bright);
  letter-spacing: 0.12em;
}

.incomplete-glyph {
  display: inline-grid;
  place-items: center;
  width: 0.95rem;
  height: 0.95rem;
  border-radius: 50%;
  background: var(--accent);
  color: #1a0a00;
  font-weight: 900;
  font-size: 0.65rem;
  line-height: 1;
  font-family: var(--mono);
}

@keyframes incomplete-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgb(245 166 35 / 0%); }
  50%      { box-shadow: 0 0 0 3px rgb(245 166 35 / 14%); }
}

/* ─── Compact density (set on the outer .match in the parent) ─── */

/* Tightens the collapsed-card header by ~50% vertically: smaller
   padding, shorter map font, smaller index, no inter-row gap.
   Adds an inline E/A/D + damage strip in the tag-row so high-volume
   players can scan stats without expanding. Vue scoped CSS scopes
   only the rightmost compound, so `.match.compact` resolves up to
   the parent's .match element. */
.match.compact .match-title-row {
  margin-bottom: 0.2rem;
}

.match.compact .match-title-lhs {
  gap: 0.55rem;
}

.match.compact .match-index {
  font-size: 0.62rem;
}

.match.compact .match-map {
  font-size: 1.15rem;
}

.match.compact .match-tag-row {
  gap: 0.3rem;
  padding-top: 0;
}

.match.compact .badge {
  padding: 0.14rem 0.5rem;
  font-size: 0.6rem;
  letter-spacing: 0.12em;
}

.match.compact .badge.hero {
  padding: 0.14rem 0.5rem;
}

.match.compact .badge.result {
  padding: 0.14rem 0.55rem;
}

/* Inline stats strip — right-aligned within .match-tag-row via
   margin-left: auto so the chips on the left pack normally and the
   stats sit at the row's far end. Tabular figures keep digit columns
   stable when scanning a list of cards. */
.compact-stats {
  display: inline-flex;
  align-items: center;
  gap: 0.7rem;
  margin-left: auto;
  font-family: var(--mono);
  font-size: 0.72rem;
  font-feature-settings: "tnum";
  color: var(--text-dim);
  letter-spacing: 0.02em;
}

.compact-ead {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  color: var(--text);
  font-weight: 600;
}

.compact-ead .compact-sep {
  color: var(--text-faint);
  font-weight: 400;
  padding: 0 0.05rem;
}

.compact-dmg {
  display: inline-flex;
  align-items: baseline;
  gap: 0.25rem;
  color: var(--text-dim);
}

.compact-unit {
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-faint);
}

/* Hide the verbose "missing X · Y" text in compact mode — keep just
   the glyph + tooltip. Saves a chunk of horizontal space on cards
   that have incomplete coverage. */
.match.compact .incomplete-text {
  display: none;
}

.match.compact .incomplete-badge {
  padding: 0.14rem 0.4rem;
}

/* ─── Leaver-mark (collapsed view; chooser lives in Expanded) ─── */

/* Inline `L` mark that sits next to the result badge on annotated
   matches. Pill-shaped, tactical-mono, colour-coded per scenario:
   self (red — your data is broken), team (loss-tinted — excuses a
   loss), enemy (win-tinted — tarnishes a win). Used in both
   comfortable and compact density modes. */
.leaver-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0;
  cursor: help;
  background: var(--surface-2);
  border: 1px solid var(--text-faint);
  color: var(--text);
  flex-shrink: 0;
}
.leaver-mark.leaver-self  { background: var(--loss-soft); border-color: var(--loss-line);  color: var(--loss); }
.leaver-mark.leaver-team  { background: var(--loss-soft); border-color: var(--loss-line);  color: var(--loss); }
.leaver-mark.leaver-enemy { background: var(--win-soft);  border-color: var(--win-line);   color: var(--win); }

/* ─── Note-present mark on the collapsed header ──────────── */

/* Sister to .leaver-mark — same pill footprint, accent-tinted to
   read as "this match has notes" without competing visually with
   the L mark when both are present. */
.note-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.05rem;
  height: 1.05rem;
  border-radius: 50%;
  background: var(--accent-soft);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-family: var(--mono);
  font-size: 0.62rem;
  font-weight: 700;
  letter-spacing: 0;
  cursor: help;
  flex-shrink: 0;
}

/* Light-mode `.incomplete-badge` override lives in app.css —
   the `:global([data-theme="light"]) .x` form miscompiles in Vue
   scoped CSS, see CLAUDE.md "Vue scoped miscompiles". */

/* ─── Narrow-viewport overrides ──────────────────────────── */

@media (width <= 580px) {
  .match-title-rhs { flex-wrap: wrap; }
  .match-map { font-size: 1.3rem; }

  /* On narrow widths the inline stats wrap to a new line; tighten
     the gap so the wrap still feels tidy. */
  .match.compact .compact-stats { margin-left: 0; gap: 0.5rem; }
}
</style>

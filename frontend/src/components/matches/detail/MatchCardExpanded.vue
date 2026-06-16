<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { MatchRecord, MatchAnnotationInput, PlayMode, QueueType, ReviewedBy, UserMatchDataInput } from '@/api'
import { isHeroUnknown, isMapUnknown } from '@/match/match-helpers'
import { formatParsedAt, fmtTime } from '@/match/match-time-helpers'
import { type SearchClause } from '@/match/search-query'
import MatchCardDanger from '@/components/matches/detail/MatchCardDanger.vue'
import MatchHeroesPlayed from '@/components/matches/detail/MatchHeroesPlayed.vue'
import MatchJournal from '@/components/matches/detail/MatchJournal.vue'
import MatchLeaverChooser from '@/components/matches/detail/MatchLeaverChooser.vue'
import MatchSources from '@/components/matches/detail/MatchSources.vue'
import MatchRankBlock from '@/components/matches/detail/MatchRankBlock.vue'
import MatchStatusChoosers from '@/components/matches/detail/MatchStatusChoosers.vue'
import EditableStat from '@/components/matches/detail/EditableStat.vue'
import { withScalarEdit, withoutField, isEmptyOverrideSet, isFieldEdited, scalarPath, type ScalarField } from '@/match/match-overrides'

// Expanded match-card body: leaver chooser → free-text annotation
// (Note / Replay / Group members) → stats grid → rank block →
// heroes-played → sources → danger row. Owns the annotation draft
// state so the user can edit the three text fields without lifting
// every keystroke up to MatchCard.vue.
//
// Extracted from MatchCard.vue so the collapsed-view and the
// expanded-view live in separate SFCs. Mounted only when the user
// clicks the chev to expand — collapsing destroys the component,
// which clears uncommitted drafts (commit on blur is required to
// persist).

const props = defineProps<{
  record: MatchRecord
  isSourcesOpen: boolean
  isPreviewOpen:   (filename: string) => boolean
  hasPreviewError: (filename: string) => boolean
  isActive: (field: string, value: string) => boolean
  // Parsed search clauses from the FilterRail. The expanded note
  // preview renders `<mark>` around every hit whose clause either
  // targets the note field or is unscoped (matches any field).
  // Optional — older mount sites omit it and the preview renders
  // without hits.
  searchClauses?: SearchClause[]
  // match_key of the current "since this match" anchor. When the
  // expanded card's record IS the anchor, the chooser shows
  // "Clear anchor" instead of "Set as anchor."
  anchorKey?: string
  // Tag vocabulary across the narrowed record set — drives the
  // inline tag-input autocomplete popover. Empty when the parent
  // hasn't threaded it through; the input still works as a free-
  // text field. Sorted alphabetically by `useMatchesNarrow`.
  availableTags?: string[]
  // One-shot focus target — when 'note' or 'tag', focus the matching
  // input on mount. Used by the right-click menu's Tag / Edit
  // annotation actions. Emits `focus-consumed` after applying so
  // the parent can clear and avoid re-focusing on re-render.
  pendingFocus?: '' | 'note' | 'tag'
}>()

const emit = defineEmits<{
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error':  [filename: string]
  // User clicked the inline preview img — App.vue opens the full-
  // screen lightbox for that filename. We lift both the intent and
  // the owning match's full source-files array so the lightbox can
  // surface prev/next navigation across the same match's screenshots
  // without reaching back into the Vue tree for the record.
  'open-lightbox':  [filename: string, files: readonly string[], dirIDs: Record<string, number>]
  'filter-toggle':  [field: string, value: string]
  // User clicks one of the four leaver-chooser buttons. App.vue
  // listens, routes through SetMatchAnnotation with the existing
  // annotation fields preserved, and re-loads records so the new
  // Annotation reflects on the next render.
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  // User edits the note / replay code / members and confirms the
  // change (debounced or on blur). App.vue calls SetMatchAnnotation
  // which writes the whole row in a single round-trip so the three
  // free-text fields can't drift independently.
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  // User pressed Hide (after confirming) or Unhide on the expanded
  // danger row.
  'set-match-hidden':      [matchKey: string, hidden: boolean]
  // User clicked one of the three review-status chips at the top
  // of the panel. An empty string means "not reviewed" — the wrapper
  // routes that to a DELETE on the /review sub-resource. Active
  // chip re-click also emits '' as a toggle-off.
  'set-match-review':      [matchKey: string, reviewedBy: ReviewedBy]
  // User clicked one of the three Queue Type radio buttons at the
  // very top of the panel. Empty string means "not set" — the api.ts
  // wrapper routes that to a DELETE on the /queue sub-resource.
  // Active chip re-click also emits '' as a toggle-off.
  'set-match-queue':       [matchKey: string, queueType: QueueType]
  // User clicked one of the three Play Mode radio buttons (below
  // the queue chooser). Empty string clears the user override and
  // reverts to the aggregator's fallback chain (data.playlist → rank
  // presence → empty). Active chip re-click toggles off.
  'set-match-play-mode':   [matchKey: string, playMode: PlayMode]
  // User flipped the "Set as 'since' anchor" toggle. App.vue's
  // `useMatchAnchor` persists the choice; this card just lifts the
  // intent. Empty string means "clear the anchor."
  'set-anchor':            [matchKey: string]
  // Tells the parent the one-shot focus target has been applied so
  // it can clear its pending-focus state.
  'focus-consumed':        []
  // User edited a match-data field inline (combat stat, etc.). Carries the
  // FULL override set to PUT (UpdateMatchData replaces the set wholesale).
  // App.vue calls UpdateMatchData + reloads.
  'update-match-data':     [matchKey: string, overrides: UserMatchDataInput]
  // User reset the whole match back to OCR (clears every override).
  'reset-match-data':      [matchKey: string]
}>()

// Drives the inline banner above the chooser block. Either is
// sufficient to show the warning; the banner's body text picks
// hero or map based on which one tripped. Mirrors the helper-driven
// pattern used elsewhere (isHeroUnknown / isMapUnknown live in
// match-helpers so the same predicate can drive leaf rows + the
// Unknown tab section).
const unknownHero = computed(() => isHeroUnknown(props.record))
const unknownMap  = computed(() => isMapUnknown(props.record))

// Sync the persisted play_mode override with what the leaf chip
// shows. Pre-fix, a match with data.playlist='competitive' and no
// override rendered as "Competitive" on the leaf (via the OCR
// fallback in formatPlayModeLabel) but the detail-panel chooser
// showed "Not set" picked AND the narrow Play-mode filter dropped
// the row — three surfaces, three answers. Fires once per match
// because MatchDetailPanel keys MatchCardExpanded by match_key,
// so a new selection destroys-and-remounts this component. Queue
// type has no OCR source, so nothing to auto-detect there.
onMounted(() => {
  const m = props.record.data?.playlist
  if (!props.record.play_mode && (m === 'quickplay' || m === 'competitive')) {
    emit('set-match-play-mode', props.record.match_key, m)
  }
})

// Inline-edit a combat scalar: resend the full override set (with this field
// added/replaced), or drop it on revert. The parent persists + reloads.
function editScalar(field: ScalarField, value: number | string) {
  emit('update-match-data', props.record.match_key, withScalarEdit(props.record, field, value))
}
function revertScalar(field: ScalarField) {
  const set = withoutField(props.record, scalarPath(field))
  // Reverting the last override empties the set — reset to OCR rather than
  // persisting an empty row that would still read as "edited".
  if (isEmptyOverrideSet(set)) {
    emit('reset-match-data', props.record.match_key)
  } else {
    emit('update-match-data', props.record.match_key, set)
  }
}
const thousands = (v: number | string) => Number(v).toLocaleString()
</script>

<template>
  <div class="match-expanded">
    <!-- Unknown-hero / Unknown-map banner. Renders above the chooser
         block when the parser captured an OCR'd hero or map name
         that didn't pin to the canonical YAML rosters. Cannot be
         dismissed; cannot be edited. Mirrors the .system-alert
         pattern from the Tesseract-missing banner: striped accent
         visual, eyebrow + title + body, no CTA beyond a download
         link to the latest reference data on the release page. -->
    <div
      v-if="unknownHero || unknownMap"
      class="unknown-alert"
      role="alert"
      data-unknown-alert
    >
      <span class="unknown-alert-eyebrow" aria-hidden="true">Reference data · gap</span>
      <h3 class="unknown-alert-title">
        {{ unknownHero ? 'Unknown hero detected' : 'Unknown map detected' }}
      </h3>
      <p class="unknown-alert-body">
        The parser couldn't match the OCR'd text to a known
        {{ unknownHero ? 'hero' : 'map' }}.
        Wait for the next Recall release to update the canonical roster.
        <span v-if="unknownHero" class="unknown-alert-ocr">(OCR read: <code>{{ record.data?.hero_raw }}</code>)</span>
        <span v-if="unknownMap" class="unknown-alert-ocr">(OCR read: <code>{{ record.data?.map_raw }}</code>)</span>
      </p>
      <a
        class="unknown-alert-link"
        href="https://github.com/sound-barrier/recall/releases/latest"
        target="_blank"
        rel="noopener noreferrer"
      >View latest release ↗</a>
    </div>

    <MatchStatusChoosers
      :record="record"
      :anchor-key="anchorKey"
      @set-match-queue="(key, value) => emit('set-match-queue', key, value)"
      @set-match-play-mode="(key, value) => emit('set-match-play-mode', key, value)"
      @set-match-review="(key, value) => emit('set-match-review', key, value)"
      @set-anchor="(key) => emit('set-anchor', key)"
    />

    <!-- Top meta strip: when the match was played + final score +
         when the screenshot was parsed. Lives at the top of the
         panel body so the user reads "what / when / how it ended"
         before scrolling into the journal. Three small lockups in
         one row; collapses to a stack on narrow widths. -->
    <div
      v-if="fmtTime(record) || record.data?.final_score || record.parsed_at"
      class="detail-meta-strip"
    >
      <div v-if="fmtTime(record)" class="meta-cell meta-cell-when">
        <span class="meta-eyebrow">When</span>
        <span class="meta-value">{{ fmtTime(record) }}</span>
      </div>
      <div v-if="record.data?.final_score" class="meta-cell meta-cell-score">
        <span class="meta-eyebrow">Final Score</span>
        <span class="meta-value">{{ record.data.final_score }}</span>
      </div>
      <div v-if="record.parsed_at" class="meta-cell meta-cell-parsed">
        <span class="meta-eyebrow">Parsed</span>
        <span class="meta-value mono-value" :title="record.parsed_at">{{ formatParsedAt(record.parsed_at) }}</span>
      </div>
    </div>

    <MatchLeaverChooser
      :record="record"
      @set-leaver-annotation="(key, leaver) => emit('set-leaver-annotation', key, leaver)"
    />

    <section class="match-stats-block" aria-labelledby="match-stats-eyebrow">
      <div id="match-stats-eyebrow" class="block-eyebrow">
        Match Stats
      </div>
      <div class="stats">
        <EditableStat
          label="Elims"
          :value="record.data?.eliminations ?? null"
          :edited="isFieldEdited(record, scalarPath('eliminations'))"
          @commit="(v) => editScalar('eliminations', v)"
          @revert="() => revertScalar('eliminations')"
        />
        <EditableStat
          label="Assists"
          :value="record.data?.assists ?? null"
          :edited="isFieldEdited(record, scalarPath('assists'))"
          @commit="(v) => editScalar('assists', v)"
          @revert="() => revertScalar('assists')"
        />
        <EditableStat
          label="Deaths"
          :value="record.data?.deaths ?? null"
          :edited="isFieldEdited(record, scalarPath('deaths'))"
          @commit="(v) => editScalar('deaths', v)"
          @revert="() => revertScalar('deaths')"
        />
        <EditableStat
          label="Damage"
          :value="record.data?.damage ?? null"
          :format="thousands"
          :edited="isFieldEdited(record, scalarPath('damage'))"
          @commit="(v) => editScalar('damage', v)"
          @revert="() => revertScalar('damage')"
        />
        <EditableStat
          label="Healing"
          :value="record.data?.healing ?? null"
          :format="thousands"
          :edited="isFieldEdited(record, scalarPath('healing'))"
          @commit="(v) => editScalar('healing', v)"
          @revert="() => revertScalar('healing')"
        />
        <EditableStat
          label="Mitigation"
          :value="record.data?.mitigation ?? null"
          :format="thousands"
          :edited="isFieldEdited(record, scalarPath('mitigation'))"
          @commit="(v) => editScalar('mitigation', v)"
          @revert="() => revertScalar('mitigation')"
        />
      </div>
    </section>

    <MatchRankBlock :record="record" />

    <MatchJournal
      :record="record"
      :search-clauses="searchClauses"
      :available-tags="availableTags"
      :pending-focus="pendingFocus"
      @set-match-annotation="(key, input) => emit('set-match-annotation', key, input)"
      @focus-consumed="emit('focus-consumed')"
    />

    <MatchHeroesPlayed
      :record="record"
      :is-active="isActive"
      @filter-toggle="(field, value) => emit('filter-toggle', field, value)"
    />

    <MatchSources
      :record="record"
      :is-sources-open="isSourcesOpen"
      :is-preview-open="isPreviewOpen"
      :has-preview-error="hasPreviewError"
      :is-active="isActive"
      @toggle-sources="emit('toggle-sources')"
      @toggle-preview="(filename) => emit('toggle-preview', filename)"
      @preview-error="(filename) => emit('preview-error', filename)"
      @open-lightbox="(filename, files, dirIDs) => emit('open-lightbox', filename, files, dirIDs)"
      @filter-toggle="(field, value) => emit('filter-toggle', field, value)"
    />

    <!-- Soft-delete row. Hide is destructive in user intent
         ("I don't want to see this match"), but reversible at the
         data layer (no rows are dropped), so we use an inline
         two-step confirm instead of a modal. Unhide is one-click —
         strictly restorative. -->
    <MatchCardDanger
      :match-key="record.match_key"
      :hidden="!!record.hidden"
      @set-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
    />
  </div>
</template>

<style scoped>
/* Unknown-hero / Unknown-map banner — same striped-accent shape as
   App.vue's .system-alert (Tesseract-missing surface). Sits above
   the chooser block; not dismissible. The accent stripe + bold
   eyebrow make it impossible to miss without crowding the rest of
   the panel. Cursor: default everywhere except the release-link
   anchor. */
.unknown-alert {
  position: relative;
  margin: 0 0 0.85rem;
  padding: 0.65rem 0.9rem 0.65rem 1.05rem;
  background: var(--accent-soft);
  border: 1px solid color-mix(in srgb, var(--accent) 35%, var(--border-strong));
  border-radius: 2px;
  border-left: 4px solid var(--accent);
  overflow: hidden;
}

.unknown-alert::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    135deg,
    transparent 0,
    transparent 12px,
    color-mix(in srgb, var(--accent) 7%, transparent) 12px,
    color-mix(in srgb, var(--accent) 7%, transparent) 24px
  );
  pointer-events: none;
}

.unknown-alert-eyebrow {
  display: inline-block;
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--accent-bright, var(--accent));
  font-weight: 700;
  margin-bottom: 0.2rem;
}

.unknown-alert-title {
  margin: 0 0 0.25rem;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.0rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text);
  font-weight: 700;
}

.unknown-alert-body {
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: var(--text);
}

.unknown-alert-ocr code {
  font-family: var(--mono);
  font-size: 0.7rem;
  background: rgb(0 0 0 / 18%);
  padding: 0.05rem 0.3rem;
  border-radius: 2px;
}

.unknown-alert-link {
  display: inline-block;
  margin-top: 0.45rem;
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--accent-bright, var(--accent));
  text-decoration: none;
  font-weight: 700;
}

.unknown-alert-link:hover,
.unknown-alert-link:focus-visible {
  text-decoration: underline;
  outline: none;
}

/* Strip browser button chrome on the chip buttons inside the
   expanded view. :where() keeps specificity at 0 so existing
   .hero-name / .source-type-chip / .slot-chip rules continue to
   win. */
:where(
  button.hero-name,
  button.source-type-chip,
  button.slot-chip
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

.hero-name.clickable:focus-visible,
.slot-chip.clickable:focus-visible,
.source-type-chip.clickable:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

.match-expanded {
  margin-top: 0.95rem;
  padding-top: 0.95rem;
  border-top: 1px dashed var(--border);
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
}

/* Detail-panel top meta strip: When / Final Score / Parsed in
   one horizontal row. On the inline-expand view this lives at the
   top of the body so the user reads the temporal frame before
   diving into the journal. Auto-wraps to a stack on narrow widths
   (the panel itself goes full-width below 720px so this should
   only kick in on really cramped screens). */
.detail-meta-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 0 1.6rem;
  align-items: baseline;
  padding-bottom: 0.55rem;
  border-bottom: 1px solid var(--border);
}

.meta-cell {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.meta-cell-score .meta-value {
  font-size: 1.45rem;
  color: var(--accent-bright, var(--accent));
  letter-spacing: 0.05em;
}

.meta-cell-parsed .meta-value {
  font-size: 0.85rem;
  text-transform: none;
  letter-spacing: 0.02em;
  color: var(--text-dim);
  font-weight: 500;
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 0.7rem;
}

.meta-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  color: var(--text-faint);
  text-transform: uppercase;
  letter-spacing: 0.22em;
}

.meta-value {
  font-family: var(--display);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.mono-value {
  font-family: var(--mono);
  font-feature-settings: "tnum";
}

/* Match-level "Parsed" meta row: same shape as the existing Final
   Score meta row; the parsed row gets a touch of breathing room
   so the two stack cleanly when both render. */
.meta-row-parsed {
  margin-top: 0.18rem;
}

/* ─── Match Stats wrapper ────────────────────────────────── */

/* .stats itself (the 6-column grid) is styled in app.css since it
   ships in both the inline-expand legacy view and this expanded
   view. The wrapper adds the "Match Stats" eyebrow above the grid
   so the section reads as a labeled card, matching Heroes Played
   / Rank Update / etc. */
.match-stats-block {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.match-stats-block .block-eyebrow {
  margin-bottom: 0;
}

</style>

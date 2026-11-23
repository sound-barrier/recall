<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { DisruptionSide, MatchRecord, PlayMode, QueueType, ReviewedBy, UserMatchDataInput } from '@/api-client'
import { isHeroUnknown, isMapUnknown } from '@/match/match-helpers'
import { formatParsedAt, fmtTime } from '@/match/match-time-helpers'
import { type SearchClause } from '@/match/search-query'
import MatchCardDanger from '@/components/matches/detail/MatchCardDanger.vue'
import MatchHeroesPlayed from '@/components/matches/detail/MatchHeroesPlayed.vue'
import MatchJournal from '@/components/matches/detail/MatchJournal.vue'
import MatchDisruptionChooser from '@/components/matches/detail/MatchDisruptionChooser.vue'
import MatchSources from '@/components/matches/detail/MatchSources.vue'
import MatchRankBlock from '@/components/matches/detail/MatchRankBlock.vue'
import MatchStatusChoosers from '@/components/matches/detail/MatchStatusChoosers.vue'
import EditableStat from '@/components/matches/detail/EditableStat.vue'
import { withScalarEdit, withoutField, isEmptyOverrideSet, isFieldEdited, scalarPath, type ScalarField } from '@/match/match-overrides'
import { FIELD_FLAG_SECTION, leftOutPaths } from '@/match/quality/field-flags'
import { captionedCrops, type StatSource } from '@/match/quality/crop-sources'
import { fieldLabel } from '@/match/quality/flag-labels'
import { useMatchClock } from '@/composables/matches/useMatchClock'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { useFieldRegionsQuery } from '@/queries/fieldRegions'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'
import { useUiStore } from '@/stores/ui'

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
  // The journal's "Apply previous" source (the chronologically previous
  // annotated match), threaded from MatchDetailPanel like availableTags.
  applySource?: Pick<MatchRecord, 'match_key' | 'annotation'> | null
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
  // User toggled a side chip in either disruption chooser. The payload is
  // the full side SET for that kind; the handler routes it through
  // SetMatchAnnotation with the other annotation fields preserved, then
  // re-loads records so the new Annotation reflects on the next render.
  'set-disruption': [matchKey: string, kind: 'leavers' | 'throwers', sides: DisruptionSide[]]
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
// The card hosts every per-match write on this surface. It reads the gate
// once and hands the two plain values to the leaf stat cells, which stay
// app-state-free.
const { writesLocked, lockReason, sessionActive } = useWriteGate()
const ui = useUiStore()
const appStore = useAppStore()

// Where on the match's screenshots each value was read, asked for on the
// first "Show source": paging the panel remounts this card per match (it is
// keyed by match_key, so the key is fixed), and most opens never look. No
// source is offered — so none is asked for, and no cached copy is read — in
// a coaching session, whose regions would name the player's files (not on
// this disk; a loaned key can even name a coach's own match), or in the
// tour, whose sample matches have no screenshots.
const coach = useCoachStore()
const sourcesOffered = computed(() => !sessionActive.value && !coach.tourOpen)
const sourceWanted = ref(false)
const regions = useFieldRegionsQuery(props.record.match_key, () => sourceWanted.value && sourcesOffered.value)

// A loaned match is clocked in the PLAYER's zone, like the row it was
// opened from and the day it is grouped under (design rule 7).
const clock = useMatchClock()

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
  // The one write this card starts on its own. It must not fire on a
  // loaned match: that key does not exist in the coach's database, and the
  // sync would write a play-mode row for another player's match.
  if (writesLocked.value) return
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

interface StatCell { field: ScalarField; label: string; format?: (v: number | string) => string }
const STAT_CELLS: readonly StatCell[] = [
  { field: 'eliminations', label: 'Elims' },
  { field: 'assists', label: 'Assists' },
  { field: 'deaths', label: 'Deaths' },
  { field: 'damage', label: 'Damage', format: thousands },
  { field: 'healing', label: 'Healing', format: thousands },
  { field: 'mitigation', label: 'Mitigation', format: thousands },
]

const flagOf = (field: ScalarField) =>
  props.record.field_flags?.find((f) => f.field === scalarPath(field)) ?? null

function sourceOf(field: ScalarField): StatSource | null {
  const value = props.record.data?.[field]
  if (!sourcesOffered.value || value === undefined || value === null || value === '') return null
  if (regions.isError.value) return { status: 'error' }
  const all = regions.data.value
  if (!all) return { status: 'pending' }
  return { status: 'ready', crops: captionedCrops(props.record, all, scalarPath(field), flagOf(field)) }
}

// The stats leave out a flagged E/A/D's whole line, so each sibling says so
// too, naming the flag it waits on.
const leftOut = computed(() => leftOutPaths(props.record))
function leftOutWith(field: ScalarField): string {
  const cause = leftOut.value.get(scalarPath(field))
  return cause && cause !== scalarPath(field) ? fieldLabel(cause, props.record.data) : ''
}

// The record here is the one AS READ, so a flagged value still shows; its
// review is the Unknown tab's, so this leaves the panel for that section.
function reviewFlag() {
  ui.selection.close()
  ui.revealSection(FIELD_FLAG_SECTION)
  void appStore.goToView('unknown')
}
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
      <span class="eyebrow unknown-alert-eyebrow" aria-hidden="true">Reference data · gap</span>
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
      v-if="fmtTime(record, clock) || record.data?.final_score || record.parsed_at"
      class="detail-meta-strip"
    >
      <div v-if="fmtTime(record, clock)" class="meta-cell meta-cell-when">
        <span class="eyebrow meta-eyebrow">When</span>
        <span class="meta-value">{{ fmtTime(record, clock) }}</span>
      </div>
      <div v-if="record.data?.final_score" class="meta-cell meta-cell-score">
        <span class="eyebrow meta-eyebrow">Final Score</span>
        <span class="meta-value">{{ record.data.final_score }}</span>
      </div>
      <div v-if="record.parsed_at" class="meta-cell meta-cell-parsed">
        <span class="eyebrow meta-eyebrow">Parsed</span>
        <span class="meta-value mono-value" :title="record.parsed_at">{{ formatParsedAt(record.parsed_at) }}</span>
      </div>
    </div>

    <MatchDisruptionChooser
      :record="record"
      kind="leavers"
      @set-disruption="(key, kind, sides) => emit('set-disruption', key, kind, sides)"
    />
    <MatchDisruptionChooser
      :record="record"
      kind="throwers"
      @set-disruption="(key, kind, sides) => emit('set-disruption', key, kind, sides)"
    />

    <section class="stack match-stats-block" aria-labelledby="match-stats-eyebrow">
      <div id="match-stats-eyebrow" class="eyebrow block-eyebrow">
        Match Stats
      </div>
      <div class="stats">
        <EditableStat
          v-for="cell in STAT_CELLS"
          :key="cell.field"
          :locked="writesLocked"
          :lock-reason="lockReason"
          :label="cell.label"
          :value="record.data?.[cell.field] ?? null"
          :format="cell.format"
          :edited="isFieldEdited(record, scalarPath(cell.field))"
          :source="sourceOf(cell.field)"
          :flag="flagOf(cell.field)"
          :left-out-with="leftOutWith(cell.field)"
          @commit="(v) => editScalar(cell.field, v)"
          @revert="() => revertScalar(cell.field)"
          @review="reviewFlag"
          @show-source="sourceWanted = true"
        />
      </div>
    </section>

    <MatchRankBlock
      :record="record"
      @update-match-data="(k, o) => emit('update-match-data', k, o)"
    />

    <MatchJournal
      :record="record"
      :search-clauses="searchClauses"
      :available-tags="availableTags"
      :pending-focus="pendingFocus"
      :apply-source="applySource"
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

<style scoped src="./match-card-expanded.css"></style>

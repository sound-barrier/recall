<script setup lang="ts">
import { computed } from 'vue'

import type { MatchRecord } from '@/api-client'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'
import { useWriteGate } from '@/composables/shared/useWriteGate'
import { isTrackedMatchKey } from '@/match/match-key'
import { playerClockNote } from '@/match/match-time-helpers'
import { useAppStore } from '@/stores/app'
import { useCoachStore } from '@/stores/coach'

// The detail panel's header chrome: the sticky toolbar (close + map·result title
// + prev/next match navigation) and the provenance banner (edited / hand-entered
// strip with the Reset-to-OCR action). Extracted from MatchDetailPanel as a
// multi-root fragment so the two strips stay direct flex children of
// `.detail-panel`. The parent owns selection + the reset action; this is
// presentational and signals intent via emits.
const props = defineProps<{
  record: MatchRecord
  mapDisplay: string
  provenanceSummary: string
  canPrev: boolean
  canNext: boolean
  positionIndex: number
  positionTotal: number
}>()

// Pinning writes; the film-room hand-off does not. During a session the
// panel is a reading surface for the player's loaned match, and the one
// place a coach can say anything about it is the room — so the header
// points there instead of pretending the pin works.
const { writesLocked, sessionActive, lockedTitle } = useWriteGate()
const appStore = useAppStore()
const coachStore = useCoachStore()

// Rule 7: the meta strip below reads this match in the PLAYER's naive
// clock, so the panel names whose clock that is — once, here.
const clockNote = computed(() => playerClockNote(coachStore.player?.handle ?? ''))

// Design rule 6: a coach's note keys on a TRACKED match. An `unmatched-` /
// `ambiguous-` sentinel is a screenshot the parser never placed, and its
// note PUT is a permanent 404 — so the hand-off refuses rather than opening
// an editor that would swallow a paragraph.
const NO_MATCH_REASON = 'This screenshot was never matched to a match, so it carries no coach\'s note.'
const ON_LOAN_NOTE = 'This match is on loan — notes go in the film room.'
const canHandOff = computed(() => isTrackedMatchKey(props.record.match_key ?? ''))
const sessionNote = computed(() => (canHandOff.value ? ON_LOAN_NOTE : NO_MATCH_REASON))

function openInFilmRoom() {
  if (!canHandOff.value) return
  coachStore.selectKey(props.record.match_key)
  void appStore.goToView('reviews')
}

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  reset: []
  pin: []
  'copy-markdown': []
  'copy-summary': []
}>()
</script>

<template>
  <header class="detail-toolbar">
    <button
      type="button"
      class="detail-icon-btn detail-close"
      aria-label="Close detail panel"
      title="Close (Esc)"
      @click="emit('close')"
    >
      <span aria-hidden="true">×</span>
    </button>

    <div class="detail-toolbar-title">
      <span id="detail-panel-title" class="detail-title-map">{{ mapDisplay }}</span>
      <span class="detail-title-sep" aria-hidden="true">·</span>
      <span
        class="detail-title-result"
        :class="`result-${record.data?.result || 'unknown'}`"
      >{{ record.data?.result || 'unknown' }}</span>
    </div>

    <button
      type="button"
      class="detail-icon-btn"
      data-copy-summary
      aria-label="Copy match summary to clipboard"
      title="Copy summary — one-line result for pasting into chat"
      @click="emit('copy-summary')"
    >
      <span aria-hidden="true">⧉</span>
    </button>
    <button
      type="button"
      class="detail-icon-btn detail-copy-md"
      data-copy-markdown
      aria-label="Copy match as Markdown to clipboard"
      title="Copy as Markdown — stats, journal, and screenshot refs"
      @click="emit('copy-markdown')"
    >
      <span aria-hidden="true">M↓</span>
    </button>
    <button
      type="button"
      class="detail-icon-btn detail-pin"
      :class="{ pinned: record.pinned }"
      data-pin-toggle
      :disabled="writesLocked"
      :aria-pressed="record.pinned ? 'true' : 'false'"
      :aria-label="record.pinned ? 'Unpin this match' : 'Pin this match'"
      :title="lockedTitle(record.pinned ? 'Unpin — remove from the Pinned section' : 'Pin — keep above the date groups')"
      @click="emit('pin')"
    >
      <span aria-hidden="true">{{ record.pinned ? '★' : '☆' }}</span>
    </button>

    <div class="detail-toolbar-nav" role="group" aria-label="Match navigation">
      <button
        type="button"
        class="detail-icon-btn"
        :disabled="!canPrev"
        :aria-label="`Previous match (left arrow). Position ${positionIndex} of ${positionTotal}`"
        :title="canPrev ? 'Previous match (←)' : 'No previous match'"
        @click="emit('prev')"
      >
        <span aria-hidden="true">←</span>
      </button>
      <span class="detail-pos" aria-live="polite">
        <strong>{{ positionIndex }}</strong>
        <span class="detail-pos-of">of {{ positionTotal }}</span>
      </span>
      <button
        type="button"
        class="detail-icon-btn"
        :disabled="!canNext"
        :aria-label="`Next match (right arrow). Position ${positionIndex} of ${positionTotal}`"
        :title="canNext ? 'Next match (→)' : 'No next match'"
        @click="emit('next')"
      >
        <span aria-hidden="true">→</span>
      </button>
    </div>
  </header>

  <!-- In-session strip. This match belongs to the player whose bundle is
       open, so nothing here writes — the coach's note about it is written
       on the desk, one click away. -->
  <div v-if="sessionActive" class="detail-session-strip" data-session-strip>
    <span class="eyebrow accent">Coaching session</span>
    <span class="detail-session-note">{{ sessionNote }}</span>
    <span class="detail-session-clock">{{ clockNote }}</span>
    <button
      type="button"
      class="detail-film-room"
      data-open-film-room
      :disabled="!canHandOff"
      :title="canHandOff ? 'Write about this match on the desk in the film room' : NO_MATCH_REASON"
      @click="openInFilmRoom"
    >
      Open in the film room →
    </button>
  </div>

  <!-- Provenance banner — pinned under the toolbar so an edited / hand-entered
       match can't be missed. Pure-OCR matches render nothing. -->
  <div
    v-if="record.source === 'ocr_edited' || record.source === 'manual'"
    class="detail-prov-banner"
    :class="record.source === 'manual' ? 'is-manual' : 'is-edited'"
    data-prov-banner
  >
    <MatchProvenanceBadge :source="record.source" :edited-fields="record.edited_fields" />
    <span class="detail-prov-sub">{{ provenanceSummary }}</span>
    <button
      v-if="record.source === 'ocr_edited'"
      type="button"
      class="detail-reset-btn"
      title="Discard every edit and restore the scanned (OCR) values"
      @click="emit('reset')"
    >
      Reset to OCR
    </button>
  </div>
</template>

<style scoped>
.detail-toolbar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.9rem 0.55rem 0.7rem;
  border-bottom: 1px solid var(--border);
  background:
    repeating-linear-gradient(135deg, var(--surface-3) 0 12px, var(--surface-2) 12px 24px);
}

.detail-icon-btn {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-family: var(--mono);
  font-size: var(--type-xl);
  line-height: 1;
  cursor: pointer;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease, background var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.detail-icon-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent-text);
  transform: translateY(-1px);
}

.detail-icon-btn:focus-visible {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 2px var(--accent-soft);
}

.detail-icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* The one affordance a coaching session ADDS to this header: the way to
   the desk, where the coach's note about this match actually goes. */
.detail-session-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  padding: 0.45rem 0.9rem;
  border-bottom: 1px solid var(--border);
  background: var(--surface-2);
}

.detail-session-note {
  flex: 1 1 auto;
  font-size: var(--type-md);
  color: var(--text-dim);
}

/* Rule 7's label for this surface: the meta strip's "When" is the
   player's naive clock, not the coach's. */
.detail-session-clock {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--text-dim);
}

.detail-film-room {
  appearance: none;
  padding: 0.25rem 0.55rem;
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--accent-text);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-radius: var(--radius);
  cursor: pointer;
}

.detail-film-room:hover {
  background: var(--accent-soft);
}

.detail-close {
  font-weight: 700;
}

.detail-toolbar-title {
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
  font-family: var(--display);
  font-style: italic;
  font-size: var(--type-3xl);
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* The map name is OW-identity typography — warm it to the identity accent,
   distinct from the interactive --accent. */
.detail-title-map {
  color: var(--identity-accent);
}

.detail-title-sep {
  color: var(--text-faint);
  font-style: normal;
  font-size: var(--type-xl);
}

.detail-title-result {
  font-family: var(--mono);
  font-style: normal;
  font-size: var(--type-sm);
  letter-spacing: 0.14em;
  font-weight: 700;
  color: var(--text-dim);
}

/* Result tint — keyed off the result class on the span itself (the parent's
   `.detail-panel.result-*` ancestor selector doesn't cross the scope boundary). */
.detail-title-result.result-victory { color: var(--win); }
.detail-title-result.result-defeat  { color: var(--loss); }
.detail-title-result.result-draw    { color: var(--draw); }

/* "Reset to OCR" — only shown on an edited match. */
.detail-reset-btn {
  appearance: none;
  font-family: var(--mono);
  font-size: var(--type-3xs);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text);
  background: transparent;
  border: 1px solid var(--accent-soft);
  border-radius: var(--radius);
  padding: 0.16rem 0.4rem;
  cursor: pointer;
}

.detail-reset-btn:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
}

.detail-reset-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Provenance banner — full-width strip under the toolbar with a left accent rule
   so "Edited" / "User entered" read at a glance. Reset-to-OCR (edited only) is
   pushed to the trailing edge. */
.detail-prov-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 1rem;
  border-bottom: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface));
}

.detail-prov-banner.is-manual {
  background: color-mix(in srgb, var(--accent) 16%, var(--surface));
}

.detail-prov-sub {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.04em;
  color: var(--text-dim);
}

.detail-prov-banner .detail-reset-btn {
  margin-left: auto;
}

.detail-toolbar-nav {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
}

.detail-pos {
  display: inline-flex;
  align-items: baseline;
  gap: 0.3rem;
  padding: 0 0.35rem;
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.08em;
  color: var(--text-faint);
  font-feature-settings: "tnum";
  white-space: nowrap;
}

.detail-pos strong {
  color: var(--text);
  font-size: var(--type-md);
  font-weight: 700;
}

.detail-pos-of { font-size: var(--type-2xs); }
</style>

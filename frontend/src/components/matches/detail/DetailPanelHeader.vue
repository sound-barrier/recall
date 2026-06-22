<script setup lang="ts">
import type { MatchRecord } from '@/api-client'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

// The detail panel's header chrome: the sticky toolbar (close + map·result title
// + prev/next match navigation) and the provenance banner (edited / hand-entered
// strip with the Reset-to-OCR action). Extracted from MatchDetailPanel as a
// multi-root fragment so the two strips stay direct flex children of
// `.detail-panel`. The parent owns selection + the reset action; this is
// presentational and signals intent via emits.
defineProps<{
  record: MatchRecord
  mapDisplay: string
  provenanceSummary: string
  canPrev: boolean
  canNext: boolean
  positionIndex: number
  positionTotal: number
}>()

const emit = defineEmits<{
  close: []
  prev: []
  next: []
  reset: []
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
  border-radius: 2px;
  color: var(--text);
  font-family: var(--mono);
  font-size: 0.95rem;
  line-height: 1;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease, background 140ms ease, transform 140ms ease;
}

.detail-icon-btn:hover:not(:disabled) {
  border-color: var(--accent);
  color: var(--accent);
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

.detail-close {
  font-weight: 700;
}

.detail-toolbar-title {
  display: inline-flex;
  align-items: baseline;
  gap: 0.55rem;
  font-family: var(--display);
  font-style: italic;
  font-size: 1.1rem;
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
  font-size: 0.95rem;
}

.detail-title-result {
  font-family: var(--mono);
  font-style: normal;
  font-size: 0.72rem;
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
  font-size: 0.55rem;
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent);
  background: transparent;
  border: 1px solid var(--accent-soft);
  border-radius: 2px;
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
  font-size: 0.62rem;
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
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  color: var(--text-faint);
  font-feature-settings: "tnum";
  white-space: nowrap;
}

.detail-pos strong {
  color: var(--text);
  font-size: 0.78rem;
  font-weight: 700;
}

.detail-pos-of { font-size: 0.6rem; }
</style>

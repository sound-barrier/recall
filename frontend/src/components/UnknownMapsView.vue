<script setup lang="ts">
import { computed, ref } from 'vue'

import type { MatchRecord } from '../api'
import { detectScreenshotSlots, screenshotURL, formatParsedAt } from '../match-helpers'
import type { CardStateApi } from '../types/cardState'

// UnknownMapsView is the triage tab for records the user needs to
// take action on:
//
//   1. AMBIGUOUS — the resolver couldn't pin the screenshot to a
//      single match. Surfaced under "Needs your review" with a
//      candidate-picker so the user attaches the screenshot to one
//      of the candidate matches (or treats it as a new match).
//   2. UNKNOWN — no map could be parsed (corrupted screenshot, or a
//      non-OW PNG in the watched folder).
//
// Per-card UI state is shared with MatchesView via the CardStateApi
// bundle, so the user's expand choices for a record carry across tabs.

const props = defineProps<{
  unknownRecords:   MatchRecord[]
  ambiguousRecords: MatchRecord[]
  allRecords:       MatchRecord[]
  cardState:        CardStateApi
}>()

const emit = defineEmits<{
  'go-to-view':         [next: 'settings' | 'ingest' | 'matches' | 'unknown']
  'resolve-ambiguous':  [ambiguousKey: string, resolvedTo: string]
  // Forwarded to App.vue's openLightbox handler — fires when the
  // user clicks an inline source-preview thumbnail. Parity with the
  // MatchDetailPanel side-panel sources block: click filename →
  // thumbnail toggle, click thumbnail → fullscreen lightbox. The
  // second arg is the owning record's source_files so the lightbox
  // can navigate between the record's screenshots without reaching
  // back into the Vue tree.
  'open-lightbox':      [filename: string, files: readonly string[]]
}>()

const ambiguousList = computed(() => props.ambiguousRecords)

// Look up a candidate match by key so the picker can show the
// candidate's hero/map/date headline without round-tripping. Returns
// undefined when the candidate is no longer in `records` (e.g. it
// was hidden + the user has show-hidden off).
function findRecord(matchKey: string): MatchRecord | undefined {
  return props.allRecords.find(r => r.match_key === matchKey)
}

function formatDistance(seconds: number): string {
  if (seconds < 60) return `${seconds}s apart`
  const mins = Math.round(seconds / 60)
  return `${mins} min apart`
}

// "Treat as new match" mints a fresh match:<ts> key from the
// ambiguous screenshot's filename timestamp so the row gets a
// standalone identity. Filename has the canonical OW format
// "...YYYY.MM.DD - HH.MM.SS.NN_*.png".
function freshKeyFromAmbiguous(rec: MatchRecord): string | null {
  const filename = rec.match_key.startsWith('ambiguous:')
    ? rec.match_key.slice('ambiguous:'.length)
    : (rec.source_files?.[0] ?? '')
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})/.exec(filename)
  if (!m) return null
  return `match:${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`
}

function onPickCandidate(rec: MatchRecord, resolvedTo: string) {
  emit('resolve-ambiguous', rec.match_key, resolvedTo)
}

// Hover-preview state for the Unknown card list. Mouseenter on a
// collapsed card sets the hovered key → the floating thumbnail
// renders anchored to the bottom-right of the card head; mouseleave
// clears it. Suppressed when the card is expanded (the per-source-file
// thumbnails in the expanded body already cover that need) and when
// the record has no source files. Pairs with the existing click-to-
// expand preview as the lower-friction triage path.
const hoveredUnknownKey = ref<string | null>(null)

function onHoverUnknown(rec: MatchRecord) {
  if (props.cardState.isSelected(rec.match_key)) return
  if (!rec.source_files?.length) return
  hoveredUnknownKey.value = rec.match_key
}

function onLeaveUnknown() {
  hoveredUnknownKey.value = null
}
</script>

<template>
  <section id="panel-unknown" role="tabpanel" aria-labelledby="tab-unknown" tabindex="-1" class="settings unknown-view">
    <header class="settings-intro">
      <p class="settings-eyebrow">
        Diagnostic Review
      </p>
      <h2 v-if="unknownRecords.length === 0 && ambiguousList.length === 0" class="settings-heading">
        All screenshots resolved.
      </h2>
      <h2 v-else class="settings-heading unknown-heading">
        <em>{{ unknownRecords.length + ambiguousList.length }} record{{ unknownRecords.length + ambiguousList.length === 1 ? '' : 's' }}</em>
        need your attention.
      </h2>
      <p v-if="unknownRecords.length > 0" class="unknown-desc">
        The slot indicators below show which screenshot types have been parsed for each record. Add the missing ones and
        <button type="button" class="empty-link" @click="emit('go-to-view', 'ingest')">
          run Parse
        </button>
        again to resolve them.
      </p>
    </header>

    <!-- ─── AMBIGUOUS: needs your review ───────────────────────── -->

    <div v-if="ambiguousList.length > 0" class="ambiguous-section">
      <h3 class="needs-review-heading">
        Needs your review — {{ ambiguousList.length }}
      </h3>
      <p class="needs-review-desc">
        These screenshots share statistics with other matches close in time. Pick the match each one belongs to, or treat it as a new match if none of the candidates is right.
      </p>
      <div class="unknown-list">
        <article
          v-for="rec in ambiguousList"
          :key="rec.match_key"
          class="unknown-card ambiguous-card"
          :class="{ expanded: cardState.isSelected(rec.match_key) }"
        >
          <div class="unknown-card-head" @click="cardState.toggleExpand(rec.match_key)">
            <div class="unknown-head-lhs">
              <span class="unknown-key-block">
                <span class="unknown-key mono">{{ rec.source_files?.[0] ?? rec.match_key }}</span>
                <span class="unknown-src-count">
                  {{ rec.candidates?.length ?? 0 }} candidate match{{ (rec.candidates?.length ?? 0) === 1 ? '' : 'es' }}
                </span>
              </span>
            </div>
            <span class="chev" :class="{ open: cardState.isSelected(rec.match_key) }" aria-hidden="true">›</span>
          </div>

          <template v-if="cardState.isSelected(rec.match_key)">
            <div class="unknown-expanded">
              <!-- Source screenshot preview — same toggle + click-to-
                   lightbox shape as the Unknown card's Source Files
                   block. Surfacing it here means the user can see the
                   actual screenshot they're triaging before picking a
                   candidate, instead of choosing blind from the match-
                   key strings alone. -->
              <div v-if="rec.source_files?.length" class="unknown-sources">
                <div class="block-eyebrow">
                  Source Screenshot
                </div>
                <div v-for="f in rec.source_files" :key="f" class="source-file">
                  <a
                    class="source-name"
                    :href="screenshotURL(f)"
                    :title="cardState.previewOpen.value[f] ? 'Hide preview' : 'Show preview'"
                    @click.prevent="cardState.togglePreview(f)"
                  >
                    <span class="chev small" :class="{ open: cardState.previewOpen.value[f] }">›</span>
                    <span class="source-name-text">{{ f }}</span>
                  </a>
                  <img
                    v-if="cardState.previewOpen.value[f] && !cardState.previewError.value[f]"
                    :src="screenshotURL(f)"
                    :alt="f"
                    class="source-preview"
                    title="Click to view fullscreen"
                    @click="emit('open-lightbox', f, rec.source_files ?? [])"
                    @error="cardState.onPreviewError(f)"
                  >
                  <div v-if="cardState.previewOpen.value[f] && cardState.previewError.value[f]" class="source-preview-error">
                    Could not load image — check screenshots folder in Settings.
                  </div>
                </div>
              </div>
              <div class="candidate-picker">
                <div class="block-eyebrow">
                  Pick the match
                </div>
                <div
                  v-for="cand in rec.candidates ?? []"
                  :key="cand.match_key"
                  class="candidate-row"
                >
                  <div class="candidate-headline">
                    <span class="candidate-key mono">{{ cand.match_key }}</span>
                    <span class="candidate-distance">{{ formatDistance(cand.distance_seconds) }}</span>
                    <span v-if="findRecord(cand.match_key)" class="candidate-summary">
                      {{ [findRecord(cand.match_key)?.data?.map, findRecord(cand.match_key)?.data?.hero, findRecord(cand.match_key)?.data?.date].filter(Boolean).join(' · ') }}
                    </span>
                  </div>
                  <button
                    type="button"
                    class="btn primary candidate-attach"
                    @click="onPickCandidate(rec, cand.match_key)"
                  >
                    Attach to this match
                  </button>
                </div>
                <button
                  v-if="freshKeyFromAmbiguous(rec)"
                  type="button"
                  class="btn ghost candidate-fresh"
                  @click="onPickCandidate(rec, freshKeyFromAmbiguous(rec)!)"
                >
                  Treat as new match
                </button>
              </div>
            </div>
          </template>
        </article>
      </div>
    </div>

    <div v-if="unknownRecords.length === 0 && ambiguousList.length === 0" class="empty">
      <div class="empty-mark">
        ◉
      </div>
      <p class="empty-title">
        No unresolved records.
      </p>
      <p class="empty-sub">
        Every parsed match has a map name — you're clean.
      </p>
    </div>

    <div v-if="unknownRecords.length > 0" class="unknown-list">
      <article
        v-for="(rec, idx) in unknownRecords"
        :key="rec.match_key"
        class="unknown-card"
        :class="{ expanded: cardState.isSelected(rec.match_key) }"
        @mouseenter="onHoverUnknown(rec)"
        @mouseleave="onLeaveUnknown"
      >
        <!-- Card header: index + match key + slot chips + chevron -->
        <div class="unknown-card-head" @click="cardState.toggleExpand(rec.match_key)">
          <div class="unknown-head-lhs">
            <span class="unknown-idx">{{ String(idx + 1).padStart(2, '0') }}</span>
            <div class="unknown-key-block">
              <span class="unknown-key mono">{{ rec.match_key }}</span>
              <span class="unknown-src-count">{{ rec.source_files?.length || 0 }} screenshot{{ (rec.source_files?.length || 0) === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <div class="unknown-head-rhs">
            <div class="slot-row" @click.stop>
              <span
                v-for="slot in detectScreenshotSlots(rec)"
                :key="slot.key"
                class="slot-chip"
                :class="{ present: slot.present, absent: !slot.present }"
                :title="slot.hint"
              >
                <span class="slot-dot" aria-hidden="true" />
                {{ slot.label }}
              </span>
            </div>
            <span class="chev" :class="{ open: cardState.isSelected(rec.match_key) }" aria-hidden="true">›</span>
          </div>
        </div>

        <!-- Field diagnostic strip — always visible -->
        <div class="unknown-fields">
          <div
            v-for="fd in [
              { label: 'Map', value: rec.data?.map },
              { label: 'Mode', value: rec.data?.mode },
              { label: 'Type', value: rec.data?.type },
              { label: 'Result', value: rec.data?.result },
              { label: 'Date', value: rec.data?.date },
              { label: 'Time', value: rec.data?.finished_at },
              { label: 'Length', value: rec.data?.game_length },
              { label: 'E/A/D', value: rec.data?.eliminations != null ? `${rec.data.eliminations} / ${rec.data.assists} / ${rec.data.deaths}` : null },
            ]"
            :key="fd.label"
            class="field-cell"
            :class="{ filled: !!fd.value, vacant: !fd.value }"
          >
            <span class="field-label">{{ fd.label }}</span>
            <span class="field-value">{{ fd.value || '—' }}</span>
          </div>
        </div>

        <!-- Expanded: source files + previews + any stats that parsed -->
        <template v-if="cardState.isSelected(rec.match_key)">
          <div class="unknown-expanded">
            <div v-if="rec.source_files?.length" class="unknown-sources">
              <div class="block-eyebrow">
                Source Files
              </div>
              <div v-for="f in rec.source_files" :key="f" class="source-file">
                <a
                  class="source-name"
                  :href="screenshotURL(f)"
                  :title="cardState.previewOpen.value[f] ? 'Hide preview' : 'Show preview'"
                  @click.prevent="cardState.togglePreview(f)"
                >
                  <span class="chev small" :class="{ open: cardState.previewOpen.value[f] }">›</span>
                  <span class="source-name-text">{{ f }}</span>
                </a>
                <span
                  v-if="rec.source_parsed_at?.[f]"
                  class="source-parsed-chip"
                  :title="`Inserted into the database at ${rec.source_parsed_at[f]} (UTC)`"
                >{{ formatParsedAt(rec.source_parsed_at[f]) }}</span>
                <img
                  v-if="cardState.previewOpen.value[f] && !cardState.previewError.value[f]"
                  :src="screenshotURL(f)"
                  :alt="f"
                  class="source-preview"
                  title="Click to view fullscreen"
                  @click="emit('open-lightbox', f, rec.source_files ?? [])"
                  @error="cardState.onPreviewError(f)"
                >
                <div v-if="cardState.previewOpen.value[f] && cardState.previewError.value[f]" class="source-preview-error">
                  Could not load image — check screenshots folder in Settings.
                </div>
              </div>
            </div>

            <div v-if="rec.data?.eliminations != null || rec.data?.damage != null" class="unknown-stats">
              <div class="block-eyebrow">
                Parsed Stats
              </div>
              <div class="stats">
                <div class="stat">
                  <span class="stat-value">{{ rec.data.eliminations ?? '—' }}</span>
                  <span class="stat-label">Elims</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.assists ?? '—' }}</span>
                  <span class="stat-label">Assists</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.deaths ?? '—' }}</span>
                  <span class="stat-label">Deaths</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.damage != null ? rec.data.damage.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Damage</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.healing != null ? rec.data.healing.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Healing</span>
                </div>
                <div class="stat">
                  <span class="stat-value">{{ rec.data.mitigation != null ? rec.data.mitigation.toLocaleString() : '—' }}</span>
                  <span class="stat-label">Mitigation</span>
                </div>
              </div>
            </div>
          </div>
        </template>

        <!-- Hover-only floating thumbnail of the first source file.
             Renders ONLY while the card is collapsed + has at least
             one source_file + the user is hovering. The expanded
             view has its own per-file thumbnails in `.unknown-sources`
             so overlapping floating thumbs would just be noise. -->
        <img
          v-if="hoveredUnknownKey === rec.match_key
            && rec.source_files?.[0]
            && !cardState.isSelected(rec.match_key)"
          class="unknown-hover-thumb"
          :src="screenshotURL(rec.source_files[0])"
          alt=""
          aria-hidden="true"
        >
      </article>
    </div>
  </section>
</template>

<style scoped>
/* ─── View intro ─────────────────────────────────────────── */

/* The heading em uses the draw/amber color — "attention, not alarm" */
.unknown-heading em {
  color: var(--draw);
  background: var(--draw-soft);
  font-style: normal;
  padding: 0 0.25rem;
  margin: 0 -0.05rem;
  border-radius: 1px;
}
:global([data-theme="light"]) .unknown-heading em { color: var(--draw); }

.unknown-desc {
  margin-top: 0.65rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.6;
  max-width: 64ch;
}

/* ─── Unknown-record cards ───────────────────────────────── */

.unknown-list {
  display: flex;
  flex-direction: column;
  gap: 0.65rem;
  margin-top: 1.6rem;
}

/* Each unknown record is a card with an amber left bar */
.unknown-card {
  position: relative;
  border: 1px solid var(--border);
  border-radius: 3px;
  background: var(--surface);
  overflow: hidden;
  transition: border-color 180ms ease, background 180ms ease;
}

.unknown-card::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--draw-line);
}

.unknown-card.expanded {
  border-color: var(--border-strong);
  background: var(--surface-2);
}

/* Card header row */
.unknown-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0.8rem 1rem 0.8rem 1.4rem;
  cursor: pointer;
  user-select: none;
  transition: background 140ms ease;
}

.unknown-card-head:hover { background: var(--surface-2); }
.unknown-card.expanded .unknown-card-head { background: transparent; }

.unknown-head-lhs {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  min-width: 0;
  flex: 1;
}

.unknown-idx {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
  letter-spacing: 0.06em;
  flex-shrink: 0;
}

.unknown-key-block {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
  min-width: 0;
}

.unknown-key {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.01em;
}

.unknown-src-count {
  font-size: 0.69rem;
  color: var(--text-faint);
}

.unknown-head-rhs {
  display: flex;
  align-items: center;
  gap: 0.85rem;
  flex-shrink: 0;
}

/* ─── 8-column field diagnostic strip ────────────────────── */

.unknown-fields {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  border-top: 1px solid var(--border-soft);
  padding: 0 1rem 0 1.4rem;
}

.field-cell {
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
  padding: 0.5rem 0.5rem 0.5rem 0;
  border-right: 1px solid var(--border-soft);
}

.field-cell:last-child { border-right: none; }

.field-label {
  font-size: 0.6rem;
  font-family: var(--mono);
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--text-faint);
  line-height: 1;
}

.field-value {
  font-size: 0.78rem;
  font-weight: 500;
  color: var(--text-mute);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.2;
}

.field-cell.filled .field-label { color: var(--text-dim); }
.field-cell.filled .field-value { color: var(--text); }

.field-cell.vacant .field-value {
  font-style: italic;
  font-size: 0.72rem;
}

/* ─── Expanded section: sources + stats ──────────────────── */

.unknown-expanded {
  border-top: 1px solid var(--border-soft);
  padding: 1rem 1.4rem;
  background: var(--surface-2);
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.unknown-sources {
  display: flex;
  flex-direction: column;
  gap: 0;
}

.unknown-sources .block-eyebrow {
  margin-bottom: 0.45rem;
}

.unknown-stats .block-eyebrow {
  margin-bottom: 0.6rem;
}

/* ─── Ambiguous-attribution section ──────────────────────── */

.ambiguous-section {
  margin-top: 1.4rem;
  margin-bottom: 1.6rem;
}

.needs-review-heading {
  font-family: var(--font-display, var(--mono));
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.04em;
  margin: 0 0 0.45rem;
  text-transform: uppercase;
}

.needs-review-desc {
  margin: 0 0 0.85rem;
  color: var(--text-dim);
  font-size: 0.875rem;
  line-height: 1.6;
  max-width: 64ch;
}

/* Ambiguous cards get a violet left bar so they stand apart from
   the amber map-unknown cards. */
.ambiguous-card::before { background: var(--accent, var(--draw-line)); }

.candidate-picker {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

.candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 3px;
}

.candidate-headline {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
  min-width: 0;
  flex: 1;
}

.candidate-key {
  font-size: 0.78rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.candidate-distance {
  font-size: 0.69rem;
  color: var(--text-faint);
}

.candidate-summary {
  font-size: 0.78rem;
  color: var(--text-dim);
}

.candidate-attach,
.candidate-fresh {
  flex-shrink: 0;
}

.candidate-fresh {
  align-self: flex-start;
  margin-top: 0.35rem;
}

/* Hover-only floating thumbnail. Anchored to the top-right of the
   card; overflows the card on hover so it doesn't squeeze the head
   row. 16:9 aspect mirrors the OW screenshot ratio so the peek
   actually looks like the source file rather than a stretched
   blob. The pointer-events: none keeps the floating element from
   intercepting the user's mouseleave when they move toward it. */
.unknown-card:has(.unknown-hover-thumb) {
  /* The default `overflow: hidden` on .unknown-card clips the
     overflowing thumb. Only relax this while a thumb is rendering
     so the ::before edge-strip clip behaviour stays intact for
     the steady-state card. */
  overflow: visible;
}

.unknown-hover-thumb {
  position: absolute;
  top: 0.5rem;
  right: 0.5rem;
  width: 240px;
  height: 135px;
  object-fit: cover;
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: 3px;
  box-shadow:
    0 8px 22px color-mix(in srgb, var(--bg) 60%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 25%, transparent);
  z-index: 6;
  pointer-events: none;
}

/* Reduced motion: thumb appears without any fade. */
@media (prefers-reduced-motion: reduce) {
  .unknown-hover-thumb { transition: none; }
}
</style>

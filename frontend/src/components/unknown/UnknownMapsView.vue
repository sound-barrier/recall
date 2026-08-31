<script setup lang="ts">
import { computed, ref } from 'vue'

import type { MatchRecord } from '@/api-client'
import { screenshotURL, hasDuplicateCandidate } from '@/match/match-helpers'
import { useArmedAction } from '@/composables/unknown/useArmedAction'
import { useUnknownSelection, unknownRowLabel } from '@/composables/unknown/useUnknownSelection'
import UnknownBulkBar from '@/components/unknown/UnknownBulkBar.vue'
import UnknownCandidatePicker from '@/components/unknown/UnknownCandidatePicker.vue'
import UnknownFailedSection from '@/components/unknown/UnknownFailedSection.vue'
import UnknownReferenceGapSection from '@/components/unknown/UnknownReferenceGapSection.vue'
import UnknownUnmatchedSection from '@/components/unknown/UnknownUnmatchedSection.vue'
import type { CardStateApi } from '@/types/cardState'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import { useWriteGate } from '@/composables/shared/useWriteGate'
// Global (unscoped) styles for the Unknown view + its section sub-components —
// the card chrome is shared across them, so it lives in one place.
import './unknown.css'

// The triage record lists come straight from the matches store's getters
// (derived off one records array); no longer prop-drilled from App.
const matchesStore = useMatchesStore()

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
// Per-card UI state + the triage actions read from the stores. This tab owns
// its own card-expand state (the set-workspace doesn't share it); the
// source-preview/lightbox state comes from the UI store, so the CardStateApi
// bundle is assembled here and forwarded to the cards.
// Design rule 8: a coaching session loans records, never files, so no
// /_screenshot/ URL is built from one — it would resolve against the
// COACH's own disk under the player's filenames.
const { sessionActive, writesLocked, lockReason } = useWriteGate()

const appStore = useAppStore()
const uiStore = useUiStore()
const { onResolveAmbiguous, onDismissFiles } = useMatchActions()
const goToView = appStore.goToView
const preloadScreenshot = uiStore.preview.preload
const openLightbox = uiStore.preview.openLightbox

// Dismiss on an ambiguous card — junk the resolver keeps offering
// candidates for should be dismissible right here, not by resolving it
// into a match first. Same two-click confirm + write gate as the other
// sections; a write, so a coaching session locks it. Dismissal is
// card-whole (every source file), and the label says so when the group
// carries more than one.
const { trigger: triggerDismiss, isArmed: isDismissArmed } = useArmedAction()

function onDismissAmbiguous(rec: MatchRecord) {
  const files = rec.source_files ?? []
  if (files.length === 0) return
  triggerDismiss(rec.match_key, () => { void onDismissFiles(files) })
}


function ambiguousDismissLabel(rec: MatchRecord): string {
  const files = rec.source_files ?? []
  const what = files.length === 1 ? (files[0] ?? '') : `${files.length} screenshots of this group`
  return isDismissArmed(rec.match_key) ? `Confirm dismissing ${what}` : `Dismiss ${what}`
}

const unknownExpanded = ref<Record<string, boolean>>({})
const cardState: CardStateApi = {
  isSelected:      (id) => !!unknownExpanded.value[id],
  isSourcesOpen:   uiStore.isSourcesOpen,
  isPreviewOpen:   uiStore.preview.isPreviewOpen,
  hasPreviewError: uiStore.preview.hasPreviewError,
  toggleExpand:    (id) => { unknownExpanded.value = { ...unknownExpanded.value, [id]: !unknownExpanded.value[id] } },
  toggleSources:   uiStore.toggleSources,
  togglePreview:   uiStore.preview.togglePreview,
  onPreviewError:  uiStore.preview.onPreviewError,
}

const ambiguousList = computed(() => matchesStore.ambiguousRecords)

// Bulk dismiss for this section. Same verb as the per-card button, applied
// wider, so it carries the same two-click confirm — and its own selection,
// separate from the unmatched and failed sections'.
const selection = useUnknownSelection({
  rows: () => ambiguousList.value.map((r) => ({ id: r.match_key, files: r.source_files ?? [] })),
  onDismissFiles: (files) => { void onDismissFiles(files) },
})

function ambiguousSelectLabel(rec: MatchRecord): string {
  return `Select ${unknownRowLabel(rec.source_files ?? [], rec.match_key)}`
}
// Template-facing aliases for the store getters (the template referenced the
// former props by bare name).
const unknownRecords = computed(() => matchesStore.unknownRecords)

// Resolve an ambiguous record to a candidate (or a freshly-minted "new match"
// key); the UnknownCandidatePicker child owns the picker UI + emits the key.
function onPickCandidate(rec: MatchRecord, resolvedTo: string) {
  void onResolveAmbiguous(rec.match_key, resolvedTo)
}

// Click the ambiguous card head: expand the card AND, if expanding
// (not collapsing), auto-open the inline source-screenshot preview
// on the first source file. Saves the user the second chevron click
// they'd otherwise need before they can compare the source image
// against the candidate previews.
//
// On expand, also pre-fetch every candidate's representative
// screenshot via the shared preload registry. Each candidate's
// preview pane <img> reads from cache when the user hovers/focuses
// it — without preload the pane flickered on every candidate switch
// because the src reloaded per candidate.
function onAmbiguousHeadClick(rec: MatchRecord) {
  const willOpen = !cardState.isSelected(rec.match_key)
  cardState.toggleExpand(rec.match_key)
  if (!willOpen || sessionActive.value) return
  for (const cand of rec.candidates ?? []) {
    if (!cand.representative_source_file) continue
    preloadScreenshot(
      screenshotURL(cand.representative_source_file, cand.representative_dir_id ?? 0),
    )
  }
  const first = rec.source_files?.[0]
  if (!first) return
  if (!cardState.isPreviewOpen(first)) {
    cardState.togglePreview(first)
  }
}

</script>

<template>
  <section id="panel-unknown" role="tabpanel" aria-labelledby="tab-unknown" tabindex="-1" class="settings unknown-view">
    <header class="settings-intro">
      <p class="eyebrow settings-eyebrow">
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
        <button type="button" class="empty-link" @click="goToView('ingest')">
          run Parse
        </button>
        again to resolve them.
      </p>

      <!-- In-page jump nav. Only renders when BOTH sections are
           present so a single-section page doesn't waste vertical
           space. Anchor links target the section IDs below so
           keyboard + skim-reading users can jump straight to the
           triage they're after without scrolling past the other. -->
      <nav
        v-if="ambiguousList.length > 0 && unknownRecords.length > 0"
        class="unknown-section-nav"
        aria-label="Sections in this view"
      >
        <a class="unknown-section-link" href="#section-ambiguous">
          Needs your review <span class="unknown-section-count">({{ ambiguousList.length }})</span>
        </a>
        <a class="unknown-section-link" href="#section-unmatched">
          Unmatched <span class="unknown-section-count">({{ unknownRecords.length }})</span>
        </a>
      </nav>
    </header>

    <!-- ─── AMBIGUOUS: needs your review ───────────────────────── -->

    <div v-if="ambiguousList.length > 0" id="section-ambiguous" class="ambiguous-section">
      <h3 class="needs-review-heading">
        Needs your review — {{ ambiguousList.length }}
      </h3>
      <p class="needs-review-desc">
        These screenshots share statistics with other matches close in time — or exactly duplicate another match's stat line hours later. Pick the match each one belongs to, or keep it separate if none of the candidates is right.
      </p>
      <div class="unknown-list">
        <UnknownBulkBar
          :selection="selection"
          row-noun="card"
          select-all-label="Select all needing review"
          region-label="Needs your review bulk actions"
          :total-rows="ambiguousList.length"
        />
        <article
          v-for="rec in ambiguousList"
          :key="rec.match_key"
          class="unknown-card ambiguous-card"
          :class="{ expanded: cardState.isSelected(rec.match_key) }"
          :aria-label="`Ambiguous screenshot ${rec.source_files?.[0] ?? rec.match_key}`"
        >
          <div class="unknown-card-head" @click="onAmbiguousHeadClick(rec)">
            <div class="unknown-head-lhs">
              <button
                type="button"
                class="leaf-checkbox unknown-select"
                role="checkbox"
                :aria-checked="selection.isSelected(rec.match_key) ? 'true' : 'false'"
                :aria-label="ambiguousSelectLabel(rec)"
                :disabled="writesLocked"
                :title="lockReason || undefined"
                @click.stop="selection.toggleSelected(rec.match_key)"
              >
                <span class="leaf-checkbox-glyph" aria-hidden="true">{{ selection.isSelected(rec.match_key) ? '✓' : '' }}</span>
              </button>
              <span class="unknown-key-block">
                <span class="unknown-key mono">{{ rec.source_files?.[0] ?? rec.match_key }}</span>
                <span v-if="hasDuplicateCandidate(rec)" class="duplicate-badge">Possible duplicate</span>
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
              <p v-if="sessionActive" class="unknown-sources-in-session">
                Screenshots aren't included in a coaching session.
              </p>
              <div v-else-if="rec.source_files?.length" class="unknown-sources">
                <div class="eyebrow block-eyebrow">
                  Source Screenshot
                </div>
                <div v-for="f in rec.source_files" :key="f" class="source-file">
                  <a
                    class="source-name"
                    :href="screenshotURL(f, rec.source_dir_ids?.[f] ?? 0)"
                    :title="cardState.isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                    @click.prevent="cardState.togglePreview(f)"
                  >
                    <span class="chev small" :class="{ open: cardState.isPreviewOpen(f) }">›</span>
                    <span class="source-name-text">{{ f }}</span>
                  </a>
                  <img
                    v-if="cardState.isPreviewOpen(f) && !cardState.hasPreviewError(f)"
                    :src="screenshotURL(f, rec.source_dir_ids?.[f] ?? 0)"
                    :alt="f"
                    class="source-preview"
                    title="Click to view fullscreen"
                    @click="openLightbox(f, rec.source_files ?? [], rec.source_dir_ids ?? {})"
                    @error="cardState.onPreviewError(f)"
                  >
                  <div v-if="cardState.isPreviewOpen(f) && cardState.hasPreviewError(f)" class="source-preview-error">
                    Could not load image — check screenshots folder in Settings.
                  </div>
                </div>
              </div>
              <UnknownCandidatePicker :rec="rec" @pick="onPickCandidate(rec, $event)" />

              <div v-if="rec.source_files?.length" class="unknown-delete-zone">
                <button
                  type="button"
                  class="unknown-delete-btn"
                  :class="{ armed: isDismissArmed(rec.match_key) }"
                  :aria-label="ambiguousDismissLabel(rec)"
                  :data-ignore-btn="rec.match_key"
                  :disabled="writesLocked"
                  :title="lockReason || undefined"
                  @click="onDismissAmbiguous(rec)"
                >
                  {{ isDismissArmed(rec.match_key) ? 'Confirm dismiss?' : 'Dismiss' }}
                </button>
                <span class="unknown-delete-hint">
                  Not a match worth keeping? Recall will skip these files on
                  future parses. They stay on disk — restore them anytime in
                  Settings → Advanced → Manage ignored files.
                </span>
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

    <UnknownUnmatchedSection :card-state="cardState" />

    <UnknownFailedSection />

    <UnknownReferenceGapSection />
  </section>
</template>


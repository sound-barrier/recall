<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { MatchRecord } from '@/api-client'
import { detectScreenshotSlots, screenshotURL } from '@/match/match-helpers'
import { useHoverThumbnail } from '@/composables/shared/useHoverThumbnail'
import UnknownCandidatePicker from '@/components/unknown/UnknownCandidatePicker.vue'
import UnknownReferenceGapSection from '@/components/unknown/UnknownReferenceGapSection.vue'
import { formatParsedAt } from '@/match/match-time-helpers'
import type { CardStateApi } from '@/types/cardState'
import { useAppStore } from '@/stores/app'
import { useMatchesStore } from '@/stores/matches'
import { useUiStore } from '@/stores/ui'
import { useMatchActions } from '@/composables/matches/useMatchActions'
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
const appStore = useAppStore()
const uiStore = useUiStore()
const { onResolveAmbiguous, onIgnoreScreenshot } = useMatchActions()
const goToView = appStore.goToView
const preloadScreenshot = uiStore.preview.preload
const openLightbox = uiStore.preview.openLightbox

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
// Template-facing aliases for the store getters (the template referenced the
// former props by bare name).
const unknownRecords = computed(() => matchesStore.unknownRecords)

// Resolve an ambiguous record to a candidate (or a freshly-minted "new match"
// key); the UnknownCandidatePicker child owns the picker UI + emits the key.
function onPickCandidate(rec: MatchRecord, resolvedTo: string) {
  onResolveAmbiguous(rec.match_key, resolvedTo)
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
  if (!willOpen) return
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

// "Delete forever" arm/disarm — mirrors DashboardEditBanner's
// destructive-confirm pattern. First click on a card's button
// flips it to an armed "Confirm delete?" state with a 3 s
// auto-disarm timer; the second click within that window fires
// the emit. Keyed by match_key so concurrent arms on multiple
// cards don't collide.
const IGNORE_ARM_MS = 3000
const armedIgnore = ref<Set<string>>(new Set())
const armTimers: Record<string, ReturnType<typeof setTimeout>> = {}

function disarmIgnore(matchKey: string) {
  const t = armTimers[matchKey]
  if (t !== undefined) {
    clearTimeout(t)
    delete armTimers[matchKey]
  }
  if (armedIgnore.value.has(matchKey)) {
    const next = new Set(armedIgnore.value)
    next.delete(matchKey)
    armedIgnore.value = next
  }
}

function onIgnoreClick(rec: MatchRecord) {
  const filename = rec.source_files?.[0]
  if (!filename) return
  if (!armedIgnore.value.has(rec.match_key)) {
    const next = new Set(armedIgnore.value)
    next.add(rec.match_key)
    armedIgnore.value = next
    armTimers[rec.match_key] = setTimeout(() => disarmIgnore(rec.match_key), IGNORE_ARM_MS)
    return
  }
  disarmIgnore(rec.match_key)
  onIgnoreScreenshot(filename)
}

function isIgnoreArmed(matchKey: string): boolean {
  return armedIgnore.value.has(matchKey)
}

// Hover-preview state for the Unknown card list. Mouseenter on a
// collapsed card sets the hovered key → the floating thumbnail
// renders next to the cursor (Teleport'd to body so it sits above
// every other surface) and follows mousemove until the user leaves
// the row. Suppressed when the card is expanded (the per-source-file
// thumbnails in the expanded body already cover that need) and when
// the record has no source files. Pairs with the existing click-to-
// expand preview as the lower-friction triage path. State + position
// math live in the shared useHoverThumbnail composable.
const {
  hoveredSrc: hoveredUnknownSrc,
  thumbX,
  thumbY,
  showThumb: showHoverThumb,
  onHover,
  onMove,
  onLeave: onLeaveUnknown,
} = useHoverThumbnail({
  isVisible: () => true,
  srcFor: (key) => {
    // Hover lives only on the unmatched cards, so resolve against that list.
    const rec = matchesStore.unknownRecords.find((r) => r.match_key === key)
    const first = rec?.source_files?.[0]
    return first ? screenshotURL(first, rec.source_dir_ids?.[first] ?? 0) : ''
  },
  // Suppress the peek while the card is expanded (its inline previews
  // already cover that need).
  canShow: (key) => !cardState.isSelected(key),
})
function onHoverUnknown(rec: MatchRecord, e: MouseEvent) { onHover(rec.match_key, e) }
function onMoveUnknown(rec: MatchRecord, e: MouseEvent) { onMove(rec.match_key, e) }

// Pre-fetch the first source file of every visible Unknown record
// via the shared composable's preload registry so the hover thumb
// shows from cache instantly. Idempotent — the composable dedupes
// URLs across consumers, so the in-card source-preview <img>'s
// later request reads from the same cached response.
function preloadVisibleScreenshots() {
  for (const rec of matchesStore.unknownRecords) {
    const first = rec.source_files?.[0]
    if (!first) continue
    preloadScreenshot(screenshotURL(first, rec.source_dir_ids?.[first] ?? 0))
  }
}

onMounted(preloadVisibleScreenshots)
watch(() => matchesStore.unknownRecords, preloadVisibleScreenshots, { deep: false })

// Touch-pointer long-press fallback for the hover thumbnail. Mouse
// users get instant peek on hover; touch users have no hover, so a
// long-press (~500 ms held without movement) shows the same thumb
// anchored to the touch point. A short tap still falls through to
// the existing click-to-expand. Skipped on small viewports
// (< 600 px) where the thumb wouldn't fit usefully; matches the
// mouse path's behaviour under reduced-motion (the global motion-
// reduce rule clamps the fade-in to 0.01 ms but the thumb still
// shows).
const LONG_PRESS_MS = 500
const PRESS_MOVE_TOLERANCE = 10

let pressTimer: ReturnType<typeof setTimeout> | null = null
let pressStartX = 0
let pressStartY = 0
let longPressFired = false

function clearPressTimer() {
  if (pressTimer !== null) {
    clearTimeout(pressTimer)
    pressTimer = null
  }
}

function shouldEnableTouchPeek(): boolean {
  if (typeof window === 'undefined') return false
  if (window.innerWidth < 600) return false
  return true
}

function onPointerDownUnknown(rec: MatchRecord, e: PointerEvent) {
  if (e.pointerType !== 'touch') return
  if (!shouldEnableTouchPeek()) return
  if (cardState.isSelected(rec.match_key)) return
  const first = rec.source_files?.[0]
  if (!first) return

  longPressFired = false
  pressStartX = e.clientX
  pressStartY = e.clientY
  clearPressTimer()
  pressTimer = setTimeout(() => {
    longPressFired = true
    // Anchor the thumb at the touch point via the shared hover composable.
    onHover(rec.match_key, { clientX: pressStartX, clientY: pressStartY } as MouseEvent)
  }, LONG_PRESS_MS)
}

function onPointerMoveUnknown(e: PointerEvent) {
  if (e.pointerType !== 'touch') return
  if (pressTimer === null) return
  const dx = Math.abs(e.clientX - pressStartX)
  const dy = Math.abs(e.clientY - pressStartY)
  if (dx > PRESS_MOVE_TOLERANCE || dy > PRESS_MOVE_TOLERANCE) clearPressTimer()
}

function onPointerEndUnknown() {
  clearPressTimer()
  if (longPressFired) {
    onLeaveUnknown()
  }
}

// Wrap the card-head click so a long-press that fired the peek
// doesn't ALSO toggle expand on touch release. `longPressFired`
// resets here so the next tap on the same card behaves normally.
function onCardHeadClick(rec: MatchRecord) {
  if (longPressFired) {
    longPressFired = false
    return
  }
  cardState.toggleExpand(rec.match_key)
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
        These screenshots share statistics with other matches close in time. Pick the match each one belongs to, or treat it as a new match if none of the candidates is right.
      </p>
      <div class="unknown-list">
        <article
          v-for="rec in ambiguousList"
          :key="rec.match_key"
          class="unknown-card ambiguous-card"
          :class="{ expanded: cardState.isSelected(rec.match_key) }"
        >
          <div class="unknown-card-head" @click="onAmbiguousHeadClick(rec)">
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

    <div v-if="unknownRecords.length > 0" id="section-unmatched" class="unknown-list">
      <article
        v-for="(rec, idx) in unknownRecords"
        :key="rec.match_key"
        class="unknown-card"
        :class="{ expanded: cardState.isSelected(rec.match_key) }"
        @mouseenter="(e) => onHoverUnknown(rec, e)"
        @mousemove="(e) => onMoveUnknown(rec, e)"
        @mouseleave="onLeaveUnknown"
        @pointerdown="(e) => onPointerDownUnknown(rec, e)"
        @pointermove="(e) => onPointerMoveUnknown(e)"
        @pointerup="onPointerEndUnknown"
        @pointercancel="onPointerEndUnknown"
      >
        <!-- Card header: index + match key + slot chips + chevron -->
        <div class="unknown-card-head" @click="onCardHeadClick(rec)">
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
              { label: 'Mode', value: rec.data?.playlist },
              { label: 'Type', value: rec.data?.game_mode },
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
                  :href="screenshotURL(f, rec.source_dir_ids?.[f] ?? 0)"
                  :title="cardState.isPreviewOpen(f) ? 'Hide preview' : 'Show preview'"
                  @click.prevent="cardState.togglePreview(f)"
                >
                  <span class="chev small" :class="{ open: cardState.isPreviewOpen(f) }">›</span>
                  <span class="source-name-text">{{ f }}</span>
                </a>
                <span
                  v-if="rec.source_parsed_at?.[f]"
                  class="source-parsed-chip"
                  :title="`Inserted into the database at ${rec.source_parsed_at[f]} (UTC)`"
                >{{ formatParsedAt(rec.source_parsed_at[f]) }}</span>
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

            <!-- "Delete forever" — destructive action zone. Two-click
                 confirm: first click arms (red 3 s timer), second click
                 fires IgnoreScreenshot(filename). The file stays on
                 disk; future parse runs skip it via the
                 ignored_screenshots suppress-list, and the
                 unmatched-<filename> match row gets wiped in lockstep
                 so the card disappears immediately. -->
            <div v-if="rec.source_files?.length" class="unknown-delete-zone">
              <button
                type="button"
                class="unknown-delete-btn"
                :class="{ armed: isIgnoreArmed(rec.match_key) }"
                :aria-label="isIgnoreArmed(rec.match_key)
                  ? `Confirm permanently ignoring ${rec.source_files[0]}`
                  : `Permanently ignore ${rec.source_files[0]}`"
                :data-ignore-btn="rec.match_key"
                @click="onIgnoreClick(rec)"
              >
                {{ isIgnoreArmed(rec.match_key) ? 'Confirm delete?' : 'Delete forever' }}
              </button>
              <span class="unknown-delete-hint">
                Recall will skip this file on future parses. The file
                stays on disk.
              </span>
            </div>
          </div>
        </template>
      </article>
    </div>

    <UnknownReferenceGapSection />

    <!-- Hover-only floating thumbnail anchored to the cursor.
         Teleport'd to body so the fixed-position thumb sits above
         the masthead, status bar, and every other layer — and so
         the card's `overflow: hidden` clip never crops it. Renders
         only while a card is hovered + the card is collapsed + the
         record has at least one source_file. The expanded view has
         its own per-file thumbnails in `.unknown-sources` so
         overlapping floats would just be noise. -->
    <Teleport to="body">
      <img
        v-if="showHoverThumb"
        class="unknown-hover-thumb"
        :src="hoveredUnknownSrc"
        :style="{ left: thumbX + 'px', top: thumbY + 'px' }"
        alt=""
        aria-hidden="true"
      >
    </Teleport>
  </section>
</template>


<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'

import type { MatchRecord, UpdateInfo } from '../api'
import { detectScreenshotSlots, screenshotURL } from '../match-helpers'
import { useContextualCallout } from '../composables/useContextualCallout'
import ContextualCallout from './ContextualCallout.vue'
import { formatParsedAt } from '../match-time-helpers'
import { filenameFromMatchKey } from '../match-key'
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
// Per-card UI state comes in via the CardStateApi bundle (owned by
// App.vue). Every field on the bundle is a function — no `.value`
// indirection in templates, no nested-ref auto-unwrap gotchas.
// MatchesView used to share this bundle but the new set-workspace
// doesn't expose per-card expand state, so UnknownMapsView is the
// only consumer.

const props = defineProps<{
  unknownRecords:   MatchRecord[]
  ambiguousRecords: MatchRecord[]
  // Records whose parser captured an OCR'd hero or map name but
  // couldn't match it to the canonical YAML rosters (e.g. Miyazaki
  // before heroes.yaml was updated). Surfaces as a new "Reference
  // data gaps" section so the user knows what's awaiting the next
  // YAML release. Cannot be edited; cannot have its hero/map
  // manually set. Required — the parent ALWAYS knows the
  // reference-gap subset, and tests need to supply it explicitly
  // so the assertion shape stays unambiguous.
  referenceGapRecords: MatchRecord[]
  allRecords:       MatchRecord[]
  cardState:        CardStateApi
  // Cache-warm helper from `useScreenshotPreview` (item 12). The
  // hover-thumb path warms the same URL the in-card source-preview
  // <img> later renders, so the bytes are in the browser cache by
  // the time the thumb mounts. Idempotent inside the composable —
  // every consumer can call it without dedup logic.
  preloadScreenshot: (url: string) => void
  // Latest release info from the masthead "Check for updates"
  // button. When populated AND the running build is older than
  // latest, each `.reference-gap-card` checks whether its
  // hero_raw / map_raw appears in updateInfo.latest_heroes /
  // latest_maps and surfaces a "Update to v<X> to recognise
  // <name>" CTA so the user knows the fix is one release away.
  // Null until the user clicks the button; UpdateInfo arrays are
  // empty when the SHA-sidecar check rejected the YAML asset.
  updateInfo: UpdateInfo | null
}>()

const emit = defineEmits<{
  'go-to-view':         [next: 'settings' | 'ingest' | 'matches' | 'unknown']
  'resolve-ambiguous':  [ambiguousKey: string, resolvedTo: string]
  // Fired by the "Delete forever" affordance on an unmatched card.
  // App.vue calls IgnoreScreenshot(filename) → reloads records.
  // The file stays on disk; the next parse run skips it.
  'ignore-screenshot':  [filename: string]
  // Forwarded to App.vue's openLightbox handler — fires when the
  // user clicks an inline source-preview thumbnail. Parity with the
  // MatchDetailPanel side-panel sources block: click filename →
  // thumbnail toggle, click thumbnail → fullscreen lightbox. The
  // second arg is the owning record's source_files so the lightbox
  // can navigate between the record's screenshots without reaching
  // back into the Vue tree.
  'open-lightbox':      [filename: string, files: readonly string[], dirIDs: Record<string, number>]
}>()

const ambiguousList = computed(() => props.ambiguousRecords)

// Contextual callout for the Reference data gaps section. Fires
// the first time any record carries the gap signal — most users
// never hit one, so a static tour step would mis-time. The
// callout explains the "wait for the YAML update" flow + the
// per-card "Fixed in v<X>" CTA the user just lit up so they map
// the surface back to its meaning the first time it appears.
const refdataGapCallout = useContextualCallout({
  id:   'unknown.refdata',
  gate: () => props.referenceGapRecords.length > 0,
})

// Reference-data-gap CTA helper. Returns the upgrade tip for a
// given gap-card record IF the upcoming release would recognise
// its OCR'd name; null otherwise. Match is case-insensitive
// (OCR captures lowercase, YAML lists Title Case) and against
// the normalized raw token (we mirror the parser's normalize:
// lowercase + strip diacritics).
function recognisingRelease(rec: MatchRecord): { version: string; url: string; name: string; kind: 'hero' | 'map' } | null {
  const info = props.updateInfo
  if (!info?.checked || !info.available) return null
  const normalize = (s: string) => s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
  const heroRaw = rec.data?.hero_raw ?? ''
  if (heroRaw) {
    const hit = (info.latest_heroes ?? []).find((h) => normalize(h) === normalize(heroRaw))
    if (hit) return { version: info.latest, url: info.url, name: hit, kind: 'hero' }
  }
  const mapRaw = rec.data?.map_raw ?? ''
  if (mapRaw) {
    const hit = (info.latest_maps ?? []).find((m) => normalize(m) === normalize(mapRaw))
    if (hit) return { version: info.latest, url: info.url, name: hit, kind: 'map' }
  }
  return null
}

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

// "Treat as new match" mints a fresh match-<ts> key from the
// ambiguous screenshot's filename timestamp so the row gets a
// standalone identity. Filename has the canonical OW format
// "...YYYY.MM.DD - HH.MM.SS.NN_*.png". The minted key uses `-`
// for every separator so the whole key stays URL-safe.
function freshKeyFromAmbiguous(rec: MatchRecord): string | null {
  const filename = filenameFromMatchKey(rec.match_key) ?? rec.source_files?.[0] ?? ''
  const m = /(\d{4})\.(\d{2})\.(\d{2}) - (\d{2})\.(\d{2})\.(\d{2})/.exec(filename)
  if (!m) return null
  return `match-${m[1]}-${m[2]}-${m[3]}T${m[4]}-${m[5]}-${m[6]}`
}

function onPickCandidate(rec: MatchRecord, resolvedTo: string) {
  emit('resolve-ambiguous', rec.match_key, resolvedTo)
}

// Active-candidate-per-ambiguous-card state. Drives the side-by-side
// preview pane in the candidate picker. Defaults to the first
// candidate that has a representative_source_file (so the pane shows
// something on first card expand); updates on hover OR keyboard focus
// of a candidate row, so keyboard-only users still get the preview
// without needing a pointer.
const activeCandidateByRec = ref<Record<string, string>>({})

function activeCandidateKey(rec: MatchRecord): string | null {
  const explicit = activeCandidateByRec.value[rec.match_key]
  if (explicit) return explicit
  const first = rec.candidates?.find(c => c.representative_source_file)
  return first?.match_key ?? null
}

function activeCandidate(rec: MatchRecord) {
  const key = activeCandidateKey(rec)
  if (!key) return undefined
  return rec.candidates?.find(c => c.match_key === key)
}

function setActiveCandidate(recKey: string, candKey: string) {
  if (activeCandidateByRec.value[recKey] === candKey) return
  activeCandidateByRec.value = { ...activeCandidateByRec.value, [recKey]: candKey }
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
  const willOpen = !props.cardState.isSelected(rec.match_key)
  props.cardState.toggleExpand(rec.match_key)
  if (!willOpen) return
  for (const cand of rec.candidates ?? []) {
    if (!cand.representative_source_file) continue
    props.preloadScreenshot(
      screenshotURL(cand.representative_source_file, cand.representative_dir_id ?? 0),
    )
  }
  const first = rec.source_files?.[0]
  if (!first) return
  if (!props.cardState.isPreviewOpen(first)) {
    props.cardState.togglePreview(first)
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
  emit('ignore-screenshot', filename)
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
// expand preview as the lower-friction triage path.
const hoveredUnknownKey = ref<string | null>(null)
const hoveredUnknownSrc = ref('')

// Cursor-anchored position. Updated on every mousemove inside the
// hovered card. Stored separately from hoveredUnknownKey so the
// thumb can re-render position without re-evaluating the gate.
const thumbX = ref(0)
const thumbY = ref(0)

// Sizing. The thumb is intentionally larger than the in-card peek
// it replaced — the user couldn't read the screenshot at 240×135;
// 360×203 (16:9, OW capture aspect) gives ~225 % more pixels and
// still fits comfortably even on 1280-wide viewports after the
// 18 px edge-flip margin.
const THUMB_W = 360
const THUMB_H = 203
const CURSOR_GAP = 18

function onHoverUnknown(rec: MatchRecord, e: MouseEvent) {
  if (props.cardState.isSelected(rec.match_key)) return
  const first = rec.source_files?.[0]
  if (!first) return
  hoveredUnknownKey.value = rec.match_key
  hoveredUnknownSrc.value = screenshotURL(first, rec.source_dir_ids?.[first] ?? 0)
  updateThumbPosition(e)
}

function onMoveUnknown(rec: MatchRecord, e: MouseEvent) {
  if (hoveredUnknownKey.value !== rec.match_key) return
  updateThumbPosition(e)
}

function onLeaveUnknown() {
  hoveredUnknownKey.value = null
  hoveredUnknownSrc.value = ''
}

// Reactive gate the Teleport binds to. mouseenter guards on
// isSelected once, but if the user expands a card WHILE hovering
// (the cursor never leaves the element so no fresh mouseenter
// fires) the stale hover key would keep the thumb on screen. This
// computed re-evaluates whenever cardState.isSelected flips, so
// the expand-during-hover path hides the thumb on the same tick.
const showHoverThumb = computed(() => {
  const key = hoveredUnknownKey.value
  if (!key) return false
  if (!hoveredUnknownSrc.value) return false
  return !props.cardState.isSelected(key)
})

// Pre-fetch the first source file of every visible Unknown record
// via the shared composable's preload registry so the hover thumb
// shows from cache instantly. Idempotent — the composable dedupes
// URLs across consumers, so the in-card source-preview <img>'s
// later request reads from the same cached response.
function preloadVisibleScreenshots() {
  for (const rec of props.unknownRecords) {
    const first = rec.source_files?.[0]
    if (!first) continue
    props.preloadScreenshot(screenshotURL(first, rec.source_dir_ids?.[first] ?? 0))
  }
}

onMounted(preloadVisibleScreenshots)
watch(() => props.unknownRecords, preloadVisibleScreenshots, { deep: false })

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
  if (props.cardState.isSelected(rec.match_key)) return
  const first = rec.source_files?.[0]
  if (!first) return

  longPressFired = false
  pressStartX = e.clientX
  pressStartY = e.clientY
  clearPressTimer()
  pressTimer = setTimeout(() => {
    longPressFired = true
    hoveredUnknownKey.value = rec.match_key
    hoveredUnknownSrc.value = screenshotURL(first, rec.source_dir_ids?.[first] ?? 0)
    // Anchor the thumb at the touch point and re-clamp into the
    // viewport via the same helper the mouse path uses.
    updateThumbPosition({ clientX: pressStartX, clientY: pressStartY } as MouseEvent)
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
    hoveredUnknownKey.value = null
    hoveredUnknownSrc.value = ''
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
  props.cardState.toggleExpand(rec.match_key)
}

// Anchor the thumb just below-right of the cursor. Edge-flip
// horizontally / vertically so it never gets clipped at the
// viewport edge — small windows (or a card hovered near the right
// rail) would otherwise cut off the right half of the screenshot.
function updateThumbPosition(e: MouseEvent) {
  let x = e.clientX + CURSOR_GAP
  let y = e.clientY + CURSOR_GAP
  if (typeof window !== 'undefined') {
    const vw = window.innerWidth
    const vh = window.innerHeight
    if (x + THUMB_W + CURSOR_GAP > vw) x = e.clientX - THUMB_W - CURSOR_GAP
    if (y + THUMB_H + CURSOR_GAP > vh) y = e.clientY - THUMB_H - CURSOR_GAP
    if (x < CURSOR_GAP) x = CURSOR_GAP
    if (y < CURSOR_GAP) y = CURSOR_GAP
  }
  thumbX.value = x
  thumbY.value = y
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
                    @click="emit('open-lightbox', f, rec.source_files ?? [], rec.source_dir_ids ?? {})"
                    @error="cardState.onPreviewError(f)"
                  >
                  <div v-if="cardState.isPreviewOpen(f) && cardState.hasPreviewError(f)" class="source-preview-error">
                    Could not load image — check screenshots folder in Settings.
                  </div>
                </div>
              </div>
              <div class="candidate-picker">
                <div class="block-eyebrow">
                  Pick the match
                </div>
                <div class="candidate-picker-grid">
                  <div class="candidate-list">
                    <div
                      v-for="cand in rec.candidates ?? []"
                      :key="cand.match_key"
                      class="candidate-row"
                      :class="{ active: activeCandidateKey(rec) === cand.match_key }"
                      @mouseenter="setActiveCandidate(rec.match_key, cand.match_key)"
                      @focusin="setActiveCandidate(rec.match_key, cand.match_key)"
                    >
                      <button
                        v-if="cand.representative_source_file"
                        type="button"
                        class="candidate-thumb"
                        :aria-label="`Open ${cand.match_key} screenshot in lightbox`"
                        :data-candidate-thumb="cand.match_key"
                        @click="emit('open-lightbox',
                                     cand.representative_source_file!,
                                     [cand.representative_source_file!],
                                     { [cand.representative_source_file!]: cand.representative_dir_id ?? 0 })"
                      >
                        <img
                          :src="screenshotURL(cand.representative_source_file, cand.representative_dir_id ?? 0)"
                          :alt="`Screenshot from ${cand.match_key}`"
                        >
                      </button>
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
                  <!-- Side-by-side preview pane. Renders the
                       currently-active candidate's representative
                       screenshot at a comfortable comparison size
                       (vs. the row's 80-ish px thumbnail). Active =
                       last hovered / focused, defaulting to the first
                       candidate so the slot is never empty when the
                       card opens. Click the pane image to escalate to
                       the fullscreen lightbox — same gesture as the
                       row thumbnails. -->
                  <aside
                    v-if="activeCandidate(rec)?.representative_source_file"
                    class="candidate-preview-pane"
                    :aria-label="`Preview of ${activeCandidate(rec)?.match_key}`"
                  >
                    <button
                      type="button"
                      class="candidate-preview-image"
                      :aria-label="`Open ${activeCandidate(rec)?.match_key} screenshot in lightbox`"
                      @click="emit('open-lightbox',
                                   activeCandidate(rec)!.representative_source_file!,
                                   [activeCandidate(rec)!.representative_source_file!],
                                   { [activeCandidate(rec)!.representative_source_file!]: activeCandidate(rec)!.representative_dir_id ?? 0 })"
                    >
                      <img
                        :src="screenshotURL(activeCandidate(rec)!.representative_source_file!, activeCandidate(rec)!.representative_dir_id ?? 0)"
                        :alt="`Screenshot from ${activeCandidate(rec)?.match_key}`"
                      >
                    </button>
                    <div class="candidate-preview-caption mono">
                      {{ activeCandidate(rec)?.match_key }}
                    </div>
                  </aside>
                </div>
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
                  @click="emit('open-lightbox', f, rec.source_files ?? [], rec.source_dir_ids ?? {})"
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

    <!-- ─── REFERENCE-DATA GAPS: Unknown heroes / maps ──────────
         Records the parser captured but couldn't pin to the
         canonical YAML rosters (e.g. Miyazaki before heroes.yaml
         was updated). No edit affordance — the only path to fix
         is a new Recall release with an updated YAML. -->
    <div v-if="referenceGapRecords.length > 0" id="section-reference-gaps" class="unknown-list reference-gap-section">
      <h3 class="needs-review-heading" data-refgap-heading>
        Reference data gaps — {{ referenceGapRecords.length }}
      </h3>
      <p class="needs-review-desc">
        The parser captured an OCR'd hero or map name in these records but couldn't match it to the canonical roster shipped with this Recall release. They'll be picked up automatically on the next launch after a YAML update.
        <a class="unknown-section-link" href="https://github.com/sound-barrier/recall/releases/latest" target="_blank" rel="noopener noreferrer">View latest release ↗</a>
      </p>
      <article
        v-for="rec in referenceGapRecords"
        :key="rec.match_key"
        class="unknown-card reference-gap-card"
        :data-reference-gap-key="rec.match_key"
      >
        <div class="unknown-card-head">
          <div class="unknown-head-lhs">
            <span class="unknown-key-block">
              <span class="unknown-key mono">{{ rec.source_files?.[0] ?? rec.match_key }}</span>
              <span class="unknown-src-count">
                <template v-if="rec.data?.hero_raw">Unknown hero: <code>{{ rec.data.hero_raw }}</code></template>
                <template v-if="rec.data?.hero_raw && rec.data?.map_raw">  ·  </template>
                <template v-if="rec.data?.map_raw">Unknown map: <code>{{ rec.data.map_raw }}</code></template>
              </span>
            </span>
          </div>
        </div>
        <p
          v-if="recognisingRelease(rec)"
          class="reference-gap-fix"
          :data-fix-cta-key="rec.match_key"
        >
          <span class="fix-eyebrow">Fixed in</span>
          <a
            class="fix-link"
            :href="recognisingRelease(rec)!.url"
            target="_blank"
            rel="noopener noreferrer"
            :title="`Open release page for v${recognisingRelease(rec)!.version}`"
          >v{{ recognisingRelease(rec)!.version }} ↗</a>
          <span class="fix-copy">
            — will recognise
            <code>{{ recognisingRelease(rec)!.name }}</code>
          </span>
        </p>
      </article>
    </div>

    <!-- Just-in-time hint on the first appearance of a gap card.
         Most users never hit one — a static tour step would
         mis-time. The callout fires when the section materialises;
         dismisses on Esc / close / Got it. -->
    <ContextualCallout
      v-if="refdataGapCallout.active()"
      target="[data-refgap-heading]"
      heading="Reference data gaps"
      body="Recall captured a hero or map name but couldn't match it to the canonical roster shipped with this release. They'll be picked up automatically once you update — every card below tells you if the fix is one release away."
      action-label="Got it"
      placement="top"
      @dismiss="refdataGapCallout.dismiss()"
      @action="refdataGapCallout.dismiss()"
    />

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

/* In-page section nav. Sits below the intro paragraph; only
   renders when both ambiguous + unmatched sections are present.
   Reads as a quiet inline menu — small caps mono labels, accent
   underline on hover/focus, no chrome around the whole strip. */
.unknown-section-nav {
  display: flex;
  gap: 1.4rem;
  margin-top: 1.1rem;
  align-items: baseline;
}

.unknown-section-link {
  font-family: var(--mono);
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--text-dim);
  text-decoration: none;
  border-bottom: 1px solid transparent;
  padding-bottom: 0.15rem;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.unknown-section-link:hover,
.unknown-section-link:focus-visible {
  color: var(--text);
  border-color: var(--accent);
  outline: none;
}

/* Per-card "Update to v<X>" CTA inside a .reference-gap-card.
   Quiet by default — accent-tinted eyebrow + monospace version
   link + plain copy — so it reads as a hint, not an alarm.
   The whole row sits below the card head with a thin top
   border to separate it from the OCR'd-name body. */
.reference-gap-fix {
  display: flex;
  align-items: baseline;
  gap: 0.45rem;
  margin: 0.55rem 0 0;
  padding-top: 0.5rem;
  border-top: 1px dashed var(--border);
  font-size: 0.78rem;
  color: var(--text-dim);
  line-height: 1.5;
  flex-wrap: wrap;
}

.fix-eyebrow {
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: var(--accent-text);
}

.fix-link {
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  text-decoration: none;
  border-bottom: 1px solid var(--accent);
  padding-bottom: 0.05rem;
  transition: color var(--duration-fast) ease;
}

.fix-link:hover,
.fix-link:focus-visible {
  color: var(--accent-text);
  outline: none;
}

.fix-copy code {
  font-family: var(--mono);
  font-size: 0.74rem;
  background: var(--surface-2);
  padding: 0.05rem 0.3rem;
  border-radius: 1px;
  color: var(--text);
}

.unknown-section-count {
  color: var(--text-faint);
  font-weight: 500;
  margin-left: 0.25rem;
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

/* Destructive action zone. Sits at the bottom of the expanded
   card body so users have already reviewed the screenshot before
   reaching it. Top border separates it from the diagnostic stats. */
.unknown-delete-zone {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding-top: 0.85rem;
  border-top: 1px solid var(--border-soft);
}

.unknown-delete-btn {
  appearance: none;
  background: transparent;
  border: 1px solid var(--loss-line, var(--loss));
  color: var(--loss);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.66rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.4rem 0.85rem;
  border-radius: 2px;
  cursor: pointer;
  transition:
    background var(--duration-fast) ease,
    color var(--duration-fast) ease,
    border-color var(--duration-fast) ease;
}

.unknown-delete-btn:hover {
  background: color-mix(in srgb, var(--loss) 10%, transparent);
}

.unknown-delete-btn:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--loss) 35%, transparent);
}

/* 3s countdown ring — wraps the button while armed and shrinks
   to nothing as the auto-disarm timer drains. Matches IGNORE_ARM_MS
   in the script block above. Pure CSS, no JS animation hooks; the
   browser's compositor handles the redraw. Reduced-motion swaps
   the animation for a static fill (the .armed background color
   already carries the "this click commits" signal). */
.unknown-delete-btn.armed {
  background: var(--loss);
  color: var(--surface);
  border-color: var(--loss);
  position: relative;
  isolation: isolate;
}

.unknown-delete-btn.armed::after {
  content: '';
  position: absolute;
  inset: -3px;
  border: 2px solid color-mix(in srgb, var(--loss) 70%, transparent);
  border-radius: 4px;
  pointer-events: none;
  animation: unknown-delete-arm-countdown 3000ms linear forwards;
  z-index: -1;
}

@keyframes unknown-delete-arm-countdown {
  0%   { clip-path: inset(0 0 0 0); opacity: 1; }
  100% { clip-path: inset(0 100% 0 0); opacity: 0.3; }
}

@media (prefers-reduced-motion: reduce) {
  .unknown-delete-btn.armed::after { animation: none; opacity: 0.6; }
}

.unknown-delete-hint {
  font-family: var(--mono);
  font-size: 0.62rem;
  color: var(--text-faint);
  line-height: 1.4;
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

/* Color-coded left bar per section so the user can tell the
   three card kinds apart at a glance. The plan called for
   red/yellow/blue but the project's token system has no blue;
   --win-line reads as "future fix coming" for the reference-gap
   case ("the next roster release will recognise this"), which
   is the right semantic even if the hue differs from the plan.
   - .ambiguous-card  → --accent (orange · action needed now)
   - .unknown-card    → --draw-line (amber · corrupted / can't classify)
   - .reference-gap-card → --win-line (green · upstream fix landed) */
.ambiguous-card::before { background: var(--accent, var(--draw-line)); }
.reference-gap-card::before { background: var(--win-line, var(--draw-line)); }

.candidate-picker {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
}

/* 2-column layout: candidate list on the left, side-by-side preview
   pane on the right. The pane uses a fixed-ish width so the list
   re-flows to fit; on narrow viewports the grid collapses to a single
   column and the pane stacks under the list (still visible, just no
   longer side-by-side). */
.candidate-picker-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) clamp(220px, 32%, 360px);
  gap: 1rem;
  align-items: start;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-width: 0;
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
  transition: border-color var(--duration-fast) ease, background var(--duration-fast) ease;
}

/* Active = the candidate whose preview the side-by-side pane is
   currently rendering. Highlighting the row makes the link between
   "what's in the pane" and "which candidate it is" explicit, so the
   user can flick down the list and watch the pane update without
   losing track. */
.candidate-row.active {
  border-color: var(--accent);
  background: var(--surface-2);
}

/* Side-by-side preview pane. Sticky-top so it stays visible while the
   user scrolls a long candidate list. Fixed aspect (16:9) on the
   image so the slot doesn't reflow as the user hovers between
   candidates. */
.candidate-preview-pane {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  position: sticky;
  top: 0.5rem;
}

.candidate-preview-image {
  appearance: none;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 3px;
  cursor: pointer;
  overflow: hidden;
  aspect-ratio: 16 / 9;
  transition: border-color var(--duration-fast) ease;
}

.candidate-preview-image:hover,
.candidate-preview-image:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.candidate-preview-image img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.candidate-preview-caption {
  font-size: 0.72rem;
  color: var(--text-dim);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

@media (width <= 720px) {
  .candidate-picker-grid {
    grid-template-columns: 1fr;
  }

  .candidate-preview-pane {
    position: static;
  }
}

/* Candidate thumbnail — 96 × 54 (16:9, OW capture aspect) so users
   resolve ambiguity by sight. Clickable: opens the same
   MatchScreenshotLightbox the in-card source-preview block uses.
   Flex layout puts the thumb on the left so the headline + attach
   button slot in at their natural widths. */
.candidate-thumb {
  appearance: none;
  flex: 0 0 auto;
  width: 96px;
  height: 54px;
  padding: 0;
  background: var(--surface-2);
  border: 1px solid var(--border);
  border-radius: 2px;
  cursor: pointer;
  overflow: hidden;
  transition: border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.candidate-thumb img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.candidate-thumb:hover,
.candidate-thumb:focus-visible {
  border-color: var(--accent);
  outline: none;
  transform: scale(1.02);
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

/* Hover-only floating thumbnail — cursor-anchored. Teleport'd to
   <body> so position: fixed + the dynamic left/top inline style
   anchor the thumb relative to the viewport, not the scoped
   ancestor chain. 16:9 aspect mirrors the OW screenshot capture
   ratio so the peek actually looks like the source file. The
   pointer-events: none keeps the floating element from intercepting
   the user's mouseleave when the cursor drifts toward it. Vue's
   <Teleport> retains the scoped data-v hash on the moved node, so
   this rule still matches against the body-level <img>. */
.unknown-hover-thumb {
  position: fixed;
  width: 360px;
  height: 203px;
  object-fit: cover;
  background: var(--surface-2);
  border: 1px solid var(--accent);
  border-radius: 3px;
  box-shadow:
    0 10px 26px color-mix(in srgb, var(--bg) 70%, transparent),
    0 0 0 1px color-mix(in srgb, var(--accent) 28%, transparent);
  z-index: 100;
  pointer-events: none;
}
</style>

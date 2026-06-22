<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue'
import { storeToRefs } from 'pinia'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useSmoothScroll } from '@/composables/matches/useSmoothScroll'
import { useUiStore } from '@/stores/ui'
import { useMatchesStore } from '@/stores/matches'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import MatchCardExpanded from '@/components/matches/detail/MatchCardExpanded.vue'
import MatchProvenanceBadge from '@/components/matches/shared/MatchProvenanceBadge.vue'

// Detail panel — slides in from the right when a match is selected.
// Replaces the previous
// inline-expansion behavior so the user can:
//   • inspect a single match deeply without losing scroll position
//   • paginate j/k through the filtered list while staying in the
//     panel
//   • dismiss with Esc or click-outside without scrolling back
//
// Hosts a single instance of MatchCardExpanded keyed by match_key
// (so the editor's local draft state resets cleanly between matches
// rather than persisting across selections). The panel itself owns
// only chrome — toolbar, scroll container, slide-in animation; the
// match body is reused from the inline-expansion era so the editor
// surface (annotation, sources, danger row) stays familiar.

// The panel reads all of its state from the Pinia stores and takes no props.
// The one remaining emit is set-anchor: App owns the anchor-confirmation toast
// (whose "view filter" action does DOM + view-nav), so the panel reports the
// toggle up rather than firing the toast itself.
const emit = defineEmits<{
  'set-anchor': [matchKey: string]
}>()

const uiStore = useUiStore()
const matchesStore = useMatchesStore()
const { selection, preview } = uiStore
const { searchClauses } = storeToRefs(matchesStore)
const { pendingFocusTarget: pendingFocus } = storeToRefs(uiStore)
const {
  onSetLeaverAnnotation, onSetMatchAnnotation, onSetMatchHidden, onSetMatchReview,
  onSetMatchQueue, onSetMatchPlayMode, onUpdateMatchData, onResetMatchData,
} = useMatchActions()

// Chrome state — same local names the template/script used as props, now
// sourced from the stores (selection + preview bundles preserve their refs).
const record = selection.selectedRecord
const isOpen = selection.isOpen
const canPrev = selection.canPrev
const canNext = selection.canNext
const positionIndex = computed(() => selection.selectedIndex.value + 1)
const positionTotal = computed(() => matchesStore.matchesNarrow.narrowedRecords.value.length)
const hasLightbox = computed(() => preview.lightboxFilename.value !== null)
const anchorKey = computed(() => matchesStore.matchAnchor.anchorKey.value)
const availableTags = computed(() => matchesStore.matchesNarrow.availableTags.value)

// Forwarded to MatchCardExpanded — per-match boolean / per-filename + field fns.
const isSourcesOpen = computed(() => uiStore.isSourcesOpen(selection.selectedKey.value))
const isPreviewOpen = preview.isPreviewOpen
const hasPreviewError = preview.hasPreviewError
const isActive = matchesStore.isNarrowChipActive

// Handlers that replace the old emits — drive the stores directly.
const togglePreview = preview.togglePreview
const onPreviewError = preview.onPreviewError
const openLightbox = preview.openLightbox
const toggleFilter = matchesStore.toggleNarrowChip
const clearPendingFocus = uiStore.clearPendingFocus
function toggleSources() { uiStore.toggleSources(selection.selectedKey.value) }

const ow = useOWData()

const closeBtnRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

// How far ↑ / ↓ scroll the panel body per press. Browser-default line-by-line is
// too slow for a tall journal, so we step ~3.5 text rows — derived from the
// body's measured line-height rather than a fixed pixel count, so it tracks the
// row height instead of drifting if the type scale changes. 80px fallback (the
// prior constant) when the body isn't mounted yet.
const SCROLL_STEP_FALLBACK_PX = 80
function scrollStepPx(): number {
  const lineHeight = bodyRef.value ? parseFloat(getComputedStyle(bodyRef.value).lineHeight) : NaN
  return Number.isFinite(lineHeight) && lineHeight > 0
    ? Math.round(lineHeight * 3.5)
    : SCROLL_STEP_FALLBACK_PX
}

// Keyboard scroll of the panel body via a momentum scroller (see
// useSmoothScroll). bodyRef is the scroll container.
const { nudgeScroll, setScrollAbsolute } = useSmoothScroll(bodyRef)

// Modal focus management.
//
// The panel is treated as a true dialog: while open, Tab / Shift+Tab
// cycle only through focusable descendants of `.detail-panel`, and
// Escape closes via the emit('close') callback. The composable also
// captures the triggering element on open and restores focus on
// close, so the user lands back where they started (typically the
// card's chev button).
//
// `containerSelector: '.detail-panel'` (not `.detail-backdrop`)
// keeps the backdrop's click-to-close affordance reachable by mouse
// while excluding it from the keyboard focus ring — there's nothing
// to do on a backdrop with a keyboard.
useModalFocusTrap(isOpen, {
  containerSelector: '.detail-panel',
  onClose: () => selection.close(),
})

// Document-level keydown listener.
//
//   • ← / → / k j  → previous / next match (timeline metaphor: left
//                    is earlier, right is later). j / k are kept as
//                    vim-style alternates.
//   • ↑ / ↓        → scroll panel body, NOT the page behind. The
//                    browser-default scroll target depends on which
//                    element has focus — close button at the top of
//                    the panel isn't inside the scroll container, so
//                    its arrow keys would bleed up to the document.
//                    Intercepting + scrollBy on bodyRef guarantees
//                    the scroll lands inside the panel regardless.
//   • PageUp/Down  → also scroll panel body (one viewport height).
//   • Home / End   → top / bottom of the panel body.
//
// Escape + Tab/Shift+Tab are handled by useModalFocusTrap — that
// composable installs its own document listener so we don't have
// to duplicate the trap logic here.
//
// All of the above are input-gated: when focus is in a textarea /
// input / contenteditable, every key passes through to the native
// editing behavior so the user can type literal arrows / j / k.
function onKeydown(e: KeyboardEvent) {
  if (!isOpen.value) return
  const target = document.activeElement as HTMLElement | null
  const tag = target?.tagName ?? ''
  const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ||
    !!target?.isContentEditable

  // Escape inside an editable field is "cancel this edit / drop
  // focus", NOT "close the dialog". Without this, the user types
  // a draft note, hits Esc to bail out of the textarea, and the
  // whole panel disappears — losing the in-flight draft and the
  // match they were inspecting. Blur the field and stop the event
  // before useModalFocusTrap's document listener (registered AFTER
  // ours, so still in the dispatch queue) sees it; the user's next
  // Escape — now that focus is no longer in an editable — falls
  // through to the trap and closes the panel as usual.
  if (e.key === 'Escape' && inEditable) {
    e.preventDefault()
    e.stopImmediatePropagation()
    target?.blur()
    return
  }

  if (inEditable) return

  switch (e.key) {
    case 'ArrowRight':
    case 'j':
    case 'l':
      if (canNext.value) { e.preventDefault(); selection.openNext() }
      return
    case 'ArrowLeft':
    case 'k':
    case 'h':
      if (canPrev.value) { e.preventDefault(); selection.openPrev() }
      return
    case 'ArrowDown':
      e.preventDefault()
      nudgeScroll(scrollStepPx())
      return
    case 'ArrowUp':
      e.preventDefault()
      nudgeScroll(-scrollStepPx())
      return
    case 'PageDown':
    case ' ': {
      const el = bodyRef.value
      if (!el) return
      e.preventDefault()
      nudgeScroll(el.clientHeight - 40)
      return
    }
    case 'PageUp': {
      const el = bodyRef.value
      if (!el) return
      e.preventDefault()
      nudgeScroll(-(el.clientHeight - 40))
      return
    }
    case 'Home':
      e.preventDefault()
      setScrollAbsolute(0)
      return
    case 'End': {
      const el = bodyRef.value
      if (!el) return
      e.preventDefault()
      setScrollAbsolute(el.scrollHeight)
      return
    }
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
})

const mapDisplay = computed(() =>
  record.value?.data?.map ? ow.mapDisplayName(record.value.data.map) : '—',
)

// One-line descriptor shown beside the provenance badge in the banner.
// Only meaningful for the two non-OCR states the banner renders for.
const provenanceSummary = computed(() => {
  if (record.value?.source === 'manual') return 'Logged by hand — no screenshots to parse.'
  const n = record.value?.edited_fields?.length ?? 0
  if (n === 0) return 'Corrected after the OCR scan.'
  return `${n} ${n === 1 ? 'field' : 'fields'} changed from the OCR scan.`
})

const resultClass = computed(() => {
  const r = record.value?.data?.result
  return r ? `result-${r}` : 'result-unknown'
})

function onBackdropClick(e: MouseEvent) {
  // Only fire on click ON the backdrop itself, not on click
  // bubbling up from the panel content.
  if (e.target === e.currentTarget) selection.close()
}
</script>

<template>
  <transition name="detail-panel">
    <div
      v-if="isOpen && record"
      ref="panelRef"
      class="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-panel-title"
      @click="onBackdropClick"
    >
      <aside
        class="detail-panel"
        :class="resultClass"
        :inert="hasLightbox || undefined"
        :aria-hidden="hasLightbox ? 'true' : undefined"
      >
        <header class="detail-toolbar">
          <button
            ref="closeBtnRef"
            type="button"
            class="detail-icon-btn detail-close"
            aria-label="Close detail panel"
            title="Close (Esc)"
            @click="selection.close()"
          >
            <span aria-hidden="true">×</span>
          </button>

          <div class="detail-toolbar-title">
            <span id="detail-panel-title" class="detail-title-map">{{ mapDisplay }}</span>
            <span class="detail-title-sep" aria-hidden="true">·</span>
            <span class="detail-title-result">{{ record.data?.result || 'unknown' }}</span>
          </div>

          <div class="detail-toolbar-nav" role="group" aria-label="Match navigation">
            <button
              type="button"
              class="detail-icon-btn"
              :disabled="!canPrev"
              :aria-label="`Previous match (left arrow). Position ${positionIndex} of ${positionTotal}`"
              :title="canPrev ? 'Previous match (←)' : 'No previous match'"
              @click="selection.openPrev()"
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
              @click="selection.openNext()"
            >
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </header>

        <!-- Provenance banner — a prominent strip pinned directly under
             the toolbar so the user can't miss that a match was edited
             or hand-entered. Both non-OCR states get equal visual
             weight here; the Reset-to-OCR action lives in the edited
             variant. Pure-OCR matches show nothing — the Source
             Screenshots block already conveys "parsed from screenshots". -->
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
            @click="onResetMatchData(record.match_key)"
          >
            Reset to OCR
          </button>
        </div>

        <!-- role="region" + aria-label inside the dialog so SR users
             on landmark-nav can jump straight to the match body
             past the toolbar. -->
        <div
          ref="bodyRef"
          class="detail-body"
          role="region"
          aria-label="Match detail"
        >
          <!-- Keyed by match_key so MatchCardExpanded's local annotation
               drafts reset cleanly when the user paginates. Without the
               key, switching from match A to match B would carry A's
               note draft into B's textarea on first paint. -->
          <MatchCardExpanded
            :key="record.match_key"
            :record="record"
            :is-sources-open="isSourcesOpen"
            :is-preview-open="isPreviewOpen"
            :has-preview-error="hasPreviewError"
            :is-active="isActive"
            :search-clauses="searchClauses"
            :anchor-key="anchorKey"
            :available-tags="availableTags"
            :pending-focus="pendingFocus"
            @focus-consumed="clearPendingFocus"
            @toggle-sources="toggleSources"
            @toggle-preview="togglePreview"
            @preview-error="onPreviewError"
            @open-lightbox="openLightbox"
            @filter-toggle="toggleFilter"
            @set-leaver-annotation="onSetLeaverAnnotation"
            @set-match-annotation="onSetMatchAnnotation"
            @set-match-hidden="onSetMatchHidden"
            @set-match-review="onSetMatchReview"
            @set-match-queue="onSetMatchQueue"
            @set-match-play-mode="onSetMatchPlayMode"
            @set-anchor="(k: string) => emit('set-anchor', k)"
            @update-match-data="onUpdateMatchData"
            @reset-match-data="onResetMatchData"
          />
        </div>
      </aside>
    </div>
  </transition>
</template>

<style scoped>
/* Detail panel — slides in from the right edge of the viewport.
   Backdrop is a subtle dim so the list stays visible underneath:
   the user can still scan the rest of the data while focused on one
   match, and `j`/`k` pagination is more discoverable when the
   surrounding cards are visible.

   Width: 540px on wide screens; full-width below 720px so mobile /
   narrow windows don't try to cram both list + panel. */

.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  background: color-mix(in srgb, var(--bg) 55%, transparent);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: flex-end;
}

.detail-panel {
  position: relative;
  width: min(540px, 100vw);
  height: 100vh;
  background: var(--surface);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  box-shadow: -28px 0 60px -24px rgb(0 0 0 / 65%);
  overflow: hidden;

  /* Pin the panel to its own compositing layer. The slide-in animates
     `transform`, so the panel paints on its own layer DURING the
     transition; once `transform` settles to none, older WebKit (the
     macOS Wails WKWebView) can fold it back into the backdrop's layer,
     and the backdrop-filter behind the always-present dossier heatmap
     then drops the whole fixed overlay — so the header flashes in, then
     vanishes. A persistent translateZ(0) keeps the layer alive after the
     transition. Chromium / Firefox / newer WebKit don't need it; it
     costs nothing there. */
  transform: translateZ(0);
}

/* Result-tinted left strip so the panel echoes the card's bar.
   3px wide; same colour scheme as `.match-bar`. */
.detail-panel::before {
  content: '';
  position: absolute;
  left: 0; top: 0; bottom: 0;
  width: 3px;
  background: var(--unknown-line);
  transition: background 200ms ease, box-shadow 200ms ease;
}

.detail-panel.result-victory::before {
  background: var(--win-line);
  box-shadow: 0 0 12px -2px var(--win-line);
}

.detail-panel.result-defeat::before {
  background: var(--loss-line);
  box-shadow: 0 0 12px -2px var(--loss-line);
}

.detail-panel.result-draw::before {
  background: var(--draw-line);
  box-shadow: 0 0 10px -2px var(--draw-line);
}

/* ─── Toolbar ─────────────────────────────────────────────── */

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

/* The map name is OW-identity typography — warm it to the identity
   accent, distinct from the interactive --accent. The separator +
   result keep their own tones. */
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

.detail-panel.result-victory .detail-title-result { color: var(--win); }
.detail-panel.result-defeat  .detail-title-result { color: var(--loss); }
.detail-panel.result-draw    .detail-title-result { color: var(--draw); }

/* "Reset to OCR" — only shown on an edited match. Small accent-outlined
   text button beside the provenance badge. */
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

/* Provenance banner — a full-width strip under the toolbar with a left
   accent rule, so both "Edited" and "User entered" read at a glance the
   moment the panel opens. The Reset-to-OCR action (edited only) is
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

/* ─── Body ────────────────────────────────────────────────── */

.detail-body {
  flex: 1;
  overflow-y: auto;
  padding: 0.85rem 1rem 2rem;
  scrollbar-width: thin;
  scrollbar-color: var(--border-strong) transparent;
}

.detail-body::-webkit-scrollbar { width: 8px; }
.detail-body::-webkit-scrollbar-thumb { background: var(--border-strong); border-radius: 4px; }

/* MatchCardExpanded's top dashed-border separator is unnecessary
   inside the panel — the toolbar already provides the visual
   boundary. Override the inherited rule. */
.detail-body :deep(.match-expanded) {
  margin-top: 0;
  padding-top: 0;
  border-top: 0;
}

/* ─── Slide-in transition ─────────────────────────────────── */

.detail-panel-enter-active,
.detail-panel-leave-active {
  transition: background 240ms ease, backdrop-filter 240ms ease;
}

.detail-panel-enter-active .detail-panel,
.detail-panel-leave-active .detail-panel {
  transition: transform 280ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.detail-panel-enter-from,
.detail-panel-leave-to {
  background: transparent;
  backdrop-filter: none;
}

.detail-panel-enter-from .detail-panel,
.detail-panel-leave-to .detail-panel {
  transform: translateX(100%);
}

@media (prefers-reduced-motion: reduce) {
  .detail-panel-enter-active,
  .detail-panel-leave-active,
  .detail-panel-enter-active .detail-panel,
  .detail-panel-leave-active .detail-panel {
    transition: none;
  }

  /* The rAF scroll tween in <script> already short-circuits to an
     instant scrollTop assignment when this media query matches —
     see setScrollAbsolute / commitScrollTarget. */
}

/* ─── Narrow-viewport handling ────────────────────────────── */

@media (width <= 720px) {
  .detail-panel {
    width: 100vw;
    border-left: 0;
  }

  .detail-backdrop {
    background: var(--bg);
    backdrop-filter: none;
  }
}
</style>

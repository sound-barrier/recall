<script setup lang="ts">
import { computed, ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useDetailPanelKeyboard } from '@/composables/matches/useDetailPanelKeyboard'
import { useUiStore } from '@/stores/ui'
import { useMatchesStore } from '@/stores/matches'
import { useMatchActions } from '@/composables/matches/useMatchActions'
import MatchCardExpanded from '@/components/matches/detail/MatchCardExpanded.vue'
import DetailPanelHeader from '@/components/matches/detail/DetailPanelHeader.vue'

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

const panelRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

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

// Document-level keyboard navigation: ← → / j k / h l paginate prev↔next, ↑ ↓ /
// PageUp/Down / Space / Home / End scroll the body, all input-gated, with
// Escape-in-editable blurring the field. Escape + Tab/Shift+Tab themselves are
// owned by useModalFocusTrap above.
useDetailPanelKeyboard({
  isOpen,
  bodyRef,
  canPrev,
  canNext,
  onPrev: () => selection.openPrev(),
  onNext: () => selection.openNext(),
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
        <DetailPanelHeader
          :record="record"
          :map-display="mapDisplay"
          :provenance-summary="provenanceSummary"
          :can-prev="canPrev"
          :can-next="canNext"
          :position-index="positionIndex"
          :position-total="positionTotal"
          @close="selection.close()"
          @prev="selection.openPrev()"
          @next="selection.openNext()"
          @reset="onResetMatchData(record.match_key)"
        />

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

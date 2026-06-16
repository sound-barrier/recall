<script setup lang="ts">
import { computed, ref, toRef, onMounted, onBeforeUnmount } from 'vue'
import type { MatchRecord, MatchAnnotationInput, PlayMode, QueueType, ReviewedBy, UserMatchDataInput } from '@/api'
import type { SearchClause } from '@/match/search-query'
import { useOWData } from '@/composables/shared/useOWData'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import { useSmoothScroll } from '@/composables/matches/useSmoothScroll'
import MatchCardExpanded from '@/components/matches/MatchCardExpanded.vue'
import MatchProvenanceBadge from '@/components/matches/MatchProvenanceBadge.vue'

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

const props = defineProps<{
  record: MatchRecord | null
  isOpen: boolean
  isSourcesOpen: boolean
  isPreviewOpen:   (filename: string) => boolean
  hasPreviewError: (filename: string) => boolean
  isActive: (field: string, value: string) => boolean
  searchClauses?: SearchClause[]
  canPrev: boolean
  canNext: boolean
  // Position-in-list chip ("3 / 47") shown in the toolbar so the
  // user always knows where they are within the filtered set.
  // Both 1-based and clamped to >= 0 by the parent.
  positionIndex: number
  positionTotal: number
  // True while the fullscreen screenshot lightbox is open above the
  // panel. Drives `inert` on the panel root so Tab + click events
  // can't bleed back into panel controls while the user is looking
  // at the full image.
  hasLightbox: boolean
  // match_key of the "since this match" anchor, threaded through so
  // the expanded card can flip its toggle's copy + style. Empty
  // string ≡ no anchor.
  anchorKey?: string
  // Tag vocabulary across the narrowed set — forwarded to
  // MatchCardExpanded for the inline tag-input autocomplete popover.
  // Optional so older mount sites that don't have the narrow state
  // don't have to thread an empty array.
  availableTags?: string[]
  // One-shot focus target — when 'note' or 'tag', the expanded card
  // focuses the matching input on mount (set via the right-click
  // menu's Tag / Edit annotation actions). Empty when no focus is
  // pending. The card emits `focus-consumed` after applying so the
  // parent can clear and avoid re-focusing on re-render.
  pendingFocus?: '' | 'note' | 'tag'
}>()

const emit = defineEmits<{
  close:           []
  prev:            []
  next:            []
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error':  [filename: string]
  'open-lightbox':  [filename: string, files: readonly string[], dirIDs: Record<string, number>]
  'filter-toggle':  [field: string, value: string]
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  'set-match-hidden':       [matchKey: string, hidden: boolean]
  'set-match-review':      [matchKey: string, reviewedBy: ReviewedBy]
  'set-match-queue':       [matchKey: string, queueType: QueueType]
  'set-match-play-mode':   [matchKey: string, playMode: PlayMode]
  // Fires once the expanded card has applied a pending focus
  // (note / tag) so App.vue can clear its pendingFocusTarget ref
  // — preventing a re-focus on every subsequent re-render.
  'focus-consumed':        []
  // User flipped the "Set as 'since' anchor" toggle. Empty string
  // means "clear the anchor."
  'set-anchor':            [matchKey: string]
  // User edited a match-data field inline; carries the full override set.
  'update-match-data':     [matchKey: string, overrides: UserMatchDataInput]
  // User clicked "Reset to OCR" to discard every edit on this match.
  'reset-match-data':      [matchKey: string]
}>()

const ow = useOWData()

const closeBtnRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

// How far ↑ / ↓ scroll the panel body per press. Browser-default
// line-by-line is too slow for a tall journal; 80px is roughly two
// stat rows / one journal cell.
const SCROLL_STEP_PX = 80

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
useModalFocusTrap(toRef(props, 'isOpen'), {
  containerSelector: '.detail-panel',
  onClose: () => emit('close'),
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
  if (!props.isOpen) return
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
      if (props.canNext) { e.preventDefault(); emit('next') }
      return
    case 'ArrowLeft':
    case 'k':
    case 'h':
      if (props.canPrev) { e.preventDefault(); emit('prev') }
      return
    case 'ArrowDown':
      e.preventDefault()
      nudgeScroll(SCROLL_STEP_PX)
      return
    case 'ArrowUp':
      e.preventDefault()
      nudgeScroll(-SCROLL_STEP_PX)
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
  props.record?.data?.map ? ow.mapDisplayName(props.record.data.map) : '—',
)

// One-line descriptor shown beside the provenance badge in the banner.
// Only meaningful for the two non-OCR states the banner renders for.
const provenanceSummary = computed(() => {
  if (props.record?.source === 'manual') return 'Logged by hand — no screenshots to parse.'
  const n = props.record?.edited_fields?.length ?? 0
  if (n === 0) return 'Corrected after the OCR scan.'
  return `${n} ${n === 1 ? 'field' : 'fields'} changed from the OCR scan.`
})

const resultClass = computed(() => {
  const r = props.record?.data?.result
  return r ? `result-${r}` : 'result-unknown'
})

function onBackdropClick(e: MouseEvent) {
  // Only fire on click ON the backdrop itself, not on click
  // bubbling up from the panel content.
  if (e.target === e.currentTarget) emit('close')
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
            @click="emit('close')"
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
            @click="emit('reset-match-data', record.match_key)"
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
            @focus-consumed="emit('focus-consumed')"
            @toggle-sources="emit('toggle-sources')"
            @toggle-preview="(f: string) => emit('toggle-preview', f)"
            @preview-error="(f: string) => emit('preview-error', f)"
            @open-lightbox="(f: string, files: readonly string[], dirIDs: Record<string, number>) => emit('open-lightbox', f, files, dirIDs)"
            @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
            @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
            @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
            @set-match-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
            @set-match-review="(k: string, by: ReviewedBy) => emit('set-match-review', k, by)"
            @set-match-queue="(k: string, q: QueueType) => emit('set-match-queue', k, q)"
            @set-match-play-mode="(k: string, m: PlayMode) => emit('set-match-play-mode', k, m)"
            @set-anchor="(k: string) => emit('set-anchor', k)"
            @update-match-data="(k: string, o: UserMatchDataInput) => emit('update-match-data', k, o)"
            @reset-match-data="(k: string) => emit('reset-match-data', k)"
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

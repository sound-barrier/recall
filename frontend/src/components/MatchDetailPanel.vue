<script setup lang="ts">
import { computed, ref, toRef, onMounted, onBeforeUnmount } from 'vue'
import type { MatchRecord, MatchAnnotationInput } from '../api'
import type { SearchClause } from '../search-query'
import { useOWData } from '../composables/useOWData'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import MatchCardExpanded from './MatchCardExpanded.vue'

// Detail panel — slides in from the right when a match is selected.
// Pattern from UI_RECOMMENDATIONS item #3. Replaces the previous
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
  previewOpen: Record<string, boolean>
  previewError: Record<string, boolean>
  isActive: (field: string, value: string) => boolean
  searchClauses?: SearchClause[]
  canPrev: boolean
  canNext: boolean
  // Position-in-list chip ("3 / 47") shown in the toolbar so the
  // user always knows where they are within the filtered set.
  // Both 1-based and clamped to >= 0 by the parent.
  positionIndex: number
  positionTotal: number
}>()

const emit = defineEmits<{
  close:           []
  prev:            []
  next:            []
  'toggle-sources': []
  'toggle-preview': [filename: string]
  'preview-error':  [filename: string]
  'filter-toggle':  [field: string, value: string]
  'set-leaver-annotation': [matchKey: string, leaver: '' | 'self' | 'team' | 'enemy']
  'set-match-annotation':  [matchKey: string, input: MatchAnnotationInput]
  'set-match-hidden':       [matchKey: string, hidden: boolean]
}>()

const ow = useOWData()

const closeBtnRef = ref<HTMLButtonElement | null>(null)
const panelRef = ref<HTMLElement | null>(null)
const bodyRef = ref<HTMLElement | null>(null)

// How far ↑ / ↓ scroll the panel body per press. Browser-default
// line-by-line is too slow for a tall journal; 80px is roughly two
// stat rows / one journal cell.
const SCROLL_STEP_PX = 80

// rAF-driven momentum scroller. Plain `scrollBy({ behavior: 'smooth' })`
// is the obvious choice, but the browser cancels and restarts the
// smooth animation on every scrollBy call — at 30Hz OS key-repeat
// that surfaces as a visible step-and-glide stutter ("skipping").
//
// Instead we maintain a single target position. Each keypress nudges
// the target; a single rAF loop tweens the body's scrollTop toward
// the target at 18% of the remaining gap per frame (~critically
// damped). Hold the key → target grows faster than position, the
// loop never stops, the body glides. Tap once → target jumps 80px,
// loop runs for ~25 frames (~400ms) until the gap closes.
//
// Honours `prefers-reduced-motion: reduce` by snapping instantly.
const scrollTarget = ref(0)
let scrollRAF = 0

function tickScroll() {
  const el = bodyRef.value
  if (!el) { scrollRAF = 0; return }
  const delta = scrollTarget.value - el.scrollTop
  if (Math.abs(delta) < 0.5) {
    el.scrollTop = scrollTarget.value
    scrollRAF = 0
    return
  }
  el.scrollTop += delta * 0.18
  scrollRAF = requestAnimationFrame(tickScroll)
}

function commitScrollTarget(next: number) {
  const el = bodyRef.value
  if (!el) return
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  scrollTarget.value = Math.max(0, Math.min(max, next))
  // Reduced-motion: skip the tween.
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = scrollTarget.value
    return
  }
  if (scrollRAF === 0) scrollRAF = requestAnimationFrame(tickScroll)
}

function nudgeScroll(deltaPx: number) {
  const el = bodyRef.value
  if (!el) return
  // First nudge after idle re-seeds target from the body's actual
  // scrollTop — the user may have scrolled via wheel / drag /
  // touchpad since the last keypress, and we want the next step
  // to land relative to where they are now (otherwise the first
  // arrow press would yank them back to wherever the last anim
  // ended).
  if (scrollRAF === 0) scrollTarget.value = el.scrollTop
  commitScrollTarget(scrollTarget.value + deltaPx)
}

function setScrollAbsolute(next: number) {
  commitScrollTarget(next)
}

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
  if (inEditable) return

  switch (e.key) {
    case 'ArrowRight':
    case 'j':
      if (props.canNext) { e.preventDefault(); emit('next') }
      return
    case 'ArrowLeft':
    case 'k':
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
  if (scrollRAF !== 0) {
    cancelAnimationFrame(scrollRAF)
    scrollRAF = 0
  }
})

const mapDisplay = computed(() =>
  props.record?.data?.map ? ow.mapDisplayName(props.record.data.map) : '—',
)

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
      <aside class="detail-panel" :class="resultClass">
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

        <div ref="bodyRef" class="detail-body">
          <!-- Keyed by match_key so MatchCardExpanded's local annotation
               drafts reset cleanly when the user paginates. Without the
               key, switching from match A to match B would carry A's
               note draft into B's textarea on first paint. -->
          <MatchCardExpanded
            :key="record.match_key"
            :record="record"
            :is-sources-open="isSourcesOpen"
            :preview-open="previewOpen"
            :preview-error="previewError"
            :is-active="isActive"
            :search-clauses="searchClauses"
            @toggle-sources="emit('toggle-sources')"
            @toggle-preview="(f: string) => emit('toggle-preview', f)"
            @preview-error="(f: string) => emit('preview-error', f)"
            @filter-toggle="(field: string, value: string) => emit('filter-toggle', field, value)"
            @set-leaver-annotation="(k: string, l: '' | 'self' | 'team' | 'enemy') => emit('set-leaver-annotation', k, l)"
            @set-match-annotation="(k: string, input: MatchAnnotationInput) => emit('set-match-annotation', k, input)"
            @set-match-hidden="(k: string, h: boolean) => emit('set-match-hidden', k, h)"
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

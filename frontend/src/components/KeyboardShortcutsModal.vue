<script setup lang="ts">
import { computed, onBeforeUnmount, ref, toRef, watch } from 'vue'

import { useModalFocusTrap } from '../composables/useModalFocusTrap'
import type { TabId } from '../composables/useTabKeyboardNav'

// "?" cheat-sheet modal. Lists keyboard bindings filtered to the
// user's current context — the binding catalog covers every scope
// the app exposes, but the rendered groups are gated by `view` +
// `panelOpen` so the user only sees what's actually reachable from
// where they are right now. The j / k pagination keys, for
// example, only show in the Matches view group when there's no
// detail panel open; when the panel IS open we hide that group
// and instead surface the Detail panel scope (which owns its own
// arrow / scroll / Esc bindings).
//
// Visual register matches the OnboardingTour HUD direction: sharp
// 3px --accent left border, monospace <kbd> pills, Big-Noodle italic
// title. No background textures or animated chrome — every byte of
// scoped CSS counts against the 120 KB total-CSS budget. Group
// headings + a compact two-column key→action grid is the whole
// surface area.

const props = defineProps<{
  open: boolean
  // Current top-level view. Used to gate per-view groups.
  view: TabId
  // True when the detail panel is open in front of the current
  // view — flips the Matches/Detail-panel pair of groups.
  panelOpen: boolean
}>()
const emit = defineEmits<{ close: [] }>()

// `open` arrives as a prop owned by App.vue. useModalFocusTrap can
// observe the state via a derived ref, but Esc inside the trap MUST
// route through the parent's `@close` handler — directly mutating
// `toRef(props, 'open').value` only updates the local prop binding
// and leaves App.vue's `openCheatsheet` ref stuck `true`, which
// would block the next `?` press from reopening the modal (a real
// regression caught in keyboard-shortcuts.spec.ts).
const openRef = toRef(props, 'open')
useModalFocusTrap(openRef, {
  containerSelector: '.kbd-modal-box',
  onClose: () => emit('close'),
})

// rAF-driven momentum scroller (same pattern as MatchDetailPanel —
// each keypress nudges a target value, a single animation loop
// closes the gap, so OS key-repeat reads as a continuous glide
// rather than a stutter of restarted scrollBy animations).
const bodyRef = ref<HTMLElement | null>(null)
const SCROLL_STEP_PX = 50
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

function nudgeScroll(deltaPx: number) {
  const el = bodyRef.value
  if (!el) return
  if (scrollRAF === 0) scrollTarget.value = el.scrollTop
  const max = Math.max(0, el.scrollHeight - el.clientHeight)
  scrollTarget.value = Math.max(0, Math.min(max, scrollTarget.value + deltaPx))
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    el.scrollTop = scrollTarget.value
    return
  }
  if (scrollRAF === 0) scrollRAF = requestAnimationFrame(tickScroll)
}

// Capture-phase keydown handler. Three responsibilities:
//
//   1. Esc closes the modal. Capture phase beats every bubble-phase
//      listener — including the detail panel's useModalFocusTrap
//      Esc — so a single press dismisses ONLY the cheatsheet, not
//      the panel underneath. (Same pattern as
//      MatchScreenshotLightbox.)
//   2. j / ↑ scroll the modal body up; k / ↓ scroll it down.
//   3. Every other non-modifier, non-Tab key is swallowed via
//      stopImmediatePropagation so the app's global shortcuts
//      (g→m view nav, `/` search focus, etc.) can't fire from
//      behind the modal. The user asked: while the cheatsheet is
//      open, nothing should happen except scrolling or closing.
//
// Modified keys (Ctrl/Cmd/Alt) pass through untouched so browser
// shortcuts (Cmd+W, F5, etc.) still work; Tab stays untouched so
// the focus trap can move focus inside the modal.
function onCaptureKey(e: KeyboardEvent) {
  if (!props.open) return
  if (e.ctrlKey || e.metaKey || e.altKey) return

  switch (e.key) {
    case 'Escape':
      e.preventDefault()
      e.stopImmediatePropagation()
      emit('close')
      return
    case 'j':
    case 'ArrowUp':
      e.preventDefault()
      e.stopImmediatePropagation()
      nudgeScroll(-SCROLL_STEP_PX)
      return
    case 'k':
    case 'ArrowDown':
      e.preventDefault()
      e.stopImmediatePropagation()
      nudgeScroll(SCROLL_STEP_PX)
      return
    case 'Tab':
    case 'Shift':
    case 'Control':
    case 'Alt':
    case 'Meta':
      return
  }

  // Any other key: swallow so app shortcuts behind the modal don't
  // fire. Don't preventDefault — leave OS / browser defaults
  // (F-keys, screenshot keys, etc.) intact.
  e.stopImmediatePropagation()
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) document.addEventListener('keydown', onCaptureKey, true)
    else {
      document.removeEventListener('keydown', onCaptureKey, true)
      // Cancel any in-flight scroll animation so an open→close→open
      // cycle starts fresh.
      if (scrollRAF !== 0) {
        cancelAnimationFrame(scrollRAF)
        scrollRAF = 0
      }
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onCaptureKey, true)
  if (scrollRAF !== 0) {
    cancelAnimationFrame(scrollRAF)
    scrollRAF = 0
  }
})

function onOverlayClick() {
  emit('close')
}

// Binding catalog. `context` discriminates when the group is
// visible:
//   - 'always'         → render unconditionally
//   - 'matches-no-panel' → only on the Matches view AND no panel up
//   - 'panel'          → only when the detail panel is open
//   - <TabId>          → only on that view
// The Matches/Detail-panel pair flips on `panelOpen` because
// Matches-view bindings (j / k card focus) are suppressed while the
// panel is up — the panel takes over those keys.
type Context = 'always' | 'matches-no-panel' | 'panel' | TabId

interface Binding {
  keys: readonly string[]
  action: string
}

interface BindingGroup {
  scope: string
  context: Context
  bindings: readonly Binding[]
}

const groups: readonly BindingGroup[] = [
  {
    scope: 'Global',
    context: 'always',
    bindings: [
      { keys: ['/'],            action: 'Focus the match-search input' },
      { keys: ['Esc'],          action: 'Clear & blur the match-search input (when focused)' },
      { keys: ['Enter'],        action: 'Open first hit in the detail panel (from match-search)' },
      { keys: ['g', 'm'],       action: 'Go to Matches view' },
      { keys: ['g', 'i'],       action: 'Go to Parse view' },
      { keys: ['g', 's'],       action: 'Go to Settings view' },
      { keys: ['g', 'a'],       action: 'Go to Analysis view' },
      { keys: ['g', 'u'],       action: 'Go to Unknown view' },
      { keys: ['?'],            action: 'Show this cheatsheet' },
    ],
  },
  {
    scope: 'Matches view',
    context: 'matches-no-panel',
    bindings: [
      { keys: ['j'],            action: 'Focus the next match card' },
      { keys: ['k'],            action: 'Focus the previous match card' },
      { keys: ['e'],            action: 'Open the detail panel for the focused card' },
      { keys: ['t'],            action: 'Focus the tags editor (auto-opens the detail panel)' },
    ],
  },
  {
    scope: 'Detail panel',
    context: 'panel',
    bindings: [
      { keys: ['→'],            action: 'Next match (timeline →)' },
      { keys: ['←'],            action: 'Previous match (timeline ←)' },
      { keys: ['j'],            action: 'Next match (alternate)' },
      { keys: ['k'],            action: 'Previous match (alternate)' },
      { keys: ['↓'],            action: 'Scroll panel body down' },
      { keys: ['↑'],            action: 'Scroll panel body up' },
      { keys: ['PgDn', 'Space'], action: 'Scroll panel body one page down' },
      { keys: ['PgUp'],         action: 'Scroll panel body one page up' },
      { keys: ['Home'],         action: 'Jump to top of panel body' },
      { keys: ['End'],          action: 'Jump to bottom of panel body' },
      { keys: ['Esc'],          action: 'Close the detail panel' },
    ],
  },
  {
    scope: 'Tablist + modals',
    context: 'always',
    bindings: [
      { keys: ['←', '→'],      action: 'Cycle tabs (focus a tab button first)' },
      { keys: ['Home'],         action: 'First tab' },
      { keys: ['End'],          action: 'Last tab' },
      { keys: ['Tab'],          action: 'Cycle focusable elements (Shift+Tab reverses)' },
      { keys: ['Esc'],          action: 'Close the active modal / cheatsheet' },
    ],
  },
]

const visibleGroups = computed(() =>
  groups.filter((g) => {
    switch (g.context) {
      case 'always':
        return true
      case 'panel':
        return props.panelOpen
      case 'matches-no-panel':
        return props.view === 'matches' && !props.panelOpen
      default:
        return g.context === props.view
    }
  }),
)
</script>

<template>
  <transition name="kbd-fade">
    <div
      v-if="open"
      class="kbd-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="kbd-modal-title"
      data-testid="kbd-shortcuts-modal"
      @click.self="onOverlayClick"
    >
      <div ref="bodyRef" class="kbd-modal-box">
        <header class="kbd-modal-header">
          <span class="kbd-modal-tag">CONTROLS</span>
          <h2 id="kbd-modal-title" class="kbd-modal-title">
            Keyboard shortcuts
          </h2>
        </header>

        <section
          v-for="group in visibleGroups"
          :key="group.scope"
          class="kbd-group"
        >
          <h3 class="kbd-group-title">
            {{ group.scope }}
          </h3>
          <dl class="kbd-list">
            <template
              v-for="(b, i) in group.bindings"
              :key="i"
            >
              <dt class="kbd-keys">
                <template
                  v-for="(k, j) in b.keys"
                  :key="j"
                >
                  <kbd class="kbd">{{ k }}</kbd>
                  <span
                    v-if="j < b.keys.length - 1"
                    class="kbd-sep"
                    aria-hidden="true"
                  >then</span>
                </template>
              </dt>
              <dd class="kbd-action">
                {{ b.action }}
              </dd>
            </template>
          </dl>
        </section>

        <footer class="kbd-modal-footer">
          <span class="kbd-foot-hint">
            Press <kbd class="kbd">Esc</kbd> to close
          </span>
          <button
            type="button"
            class="btn ghost tiny"
            @click="emit('close')"
          >
            Close
          </button>
        </footer>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* Lean HUD modal. Sharp accent left edge, monospace <kbd> pills,
   Big-Noodle italic title. No background textures / animated chrome
   so the scoped CSS fits inside the 120 KB total-CSS budget. */

.kbd-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
}

.kbd-modal-box {
  width: min(620px, 100%);
  max-height: calc(100vh - 4rem);
  overflow-y: auto;
  background: var(--surface);
  border: 1px solid var(--surface-3);
  border-left: 3px solid var(--accent);
  padding: 1.6rem 1.8rem 1.2rem 1.4rem;
  box-shadow: 0 24px 64px rgb(0 0 0 / 55%);
}

.kbd-modal-header {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  margin-bottom: 1.1rem;
}

.kbd-modal-tag {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.3em;
  color: var(--accent);
  text-transform: uppercase;
}

.kbd-modal-title {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  font-size: clamp(1.5rem, 2.4vw, 1.95rem);
  letter-spacing: 0.01em;
  line-height: 1.05;
  color: var(--text);
  margin: 0;
}

.kbd-group {
  margin-bottom: 1.1rem;
}

.kbd-group-title {
  font-family: var(--mono);
  font-size: 0.66rem;
  letter-spacing: 0.22em;
  color: var(--text-dim);
  text-transform: uppercase;
  margin: 0 0 0.55rem;
  padding-bottom: 0.3rem;
  border-bottom: 1px dashed color-mix(in srgb, var(--text-faint) 38%, transparent);
}

.kbd-list {
  display: grid;
  grid-template-columns: 9rem minmax(0, 1fr);
  gap: 0.45rem 1rem;
  margin: 0;
}

.kbd-keys {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  flex-wrap: wrap;
  margin: 0;
}

.kbd {
  display: inline-block;
  padding: 0.12rem 0.4rem;
  background: var(--surface-3);
  border: 1px solid color-mix(in srgb, var(--accent) 18%, var(--text-faint));
  font-family: var(--mono);
  font-size: 0.78rem;
  color: var(--text);
  line-height: 1.2;
}

.kbd-sep {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.18em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.kbd-action {
  margin: 0;
  font-size: 0.88rem;
  color: var(--text-dim);
  align-self: center;
}

.kbd-modal-footer {
  margin-top: 0.6rem;
  padding-top: 0.8rem;
  border-top: 1px dashed color-mix(in srgb, var(--text-faint) 38%, transparent);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.kbd-foot-hint {
  font-family: var(--mono);
  font-size: 0.72rem;
  color: var(--text-faint);
}

.kbd-fade-enter-active,
.kbd-fade-leave-active { transition: opacity 200ms ease; }

.kbd-fade-enter-from,
.kbd-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .kbd-fade-enter-active,
  .kbd-fade-leave-active {
    transition: none !important;
  }
}
</style>

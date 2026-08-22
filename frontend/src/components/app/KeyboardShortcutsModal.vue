<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, toRef } from 'vue'

import { SHORTCUT_GROUPS } from '@/components/app/keyboard-shortcuts.data'
import { useModalFocusTrap } from '@/composables/shared/keyboard/useModalFocusTrap'
import { useSmoothScroll } from '@/composables/matches/list/useSmoothScroll'
import type { ViewId } from '@/composables/shared/keyboard/useTabKeyboardNav'

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
  // Current top-level view.
  view: ViewId
  // True when the detail panel is open in front of the current
  // view — flips the Matches/Detail-panel pair of groups.
  panelOpen: boolean
  // True while a film-room session is open. The reel bindings are
  // advertised only on the Reviews tab WITH the room open — not on the shelf
  // the same tab shows between sessions, and not on the player's tabs a
  // coach steps into from the room, where the reel is not mounted.
  roomOpen: boolean
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

// rAF-driven momentum scroller (shared with MatchDetailPanel — each
// keypress nudges a target value, a single animation loop closes the
// gap, so OS key-repeat reads as a continuous glide rather than a
// stutter of restarted scrollBy animations). The composable owns the
// loop + its unmount cleanup; on close the v-if removes the box, the
// element ref goes null, and the loop self-terminates.
const bodyRef = ref<HTMLElement | null>(null)
const SCROLL_STEP_PX = 50
const { nudgeScroll } = useSmoothScroll(bodyRef)

// Capture-phase keydown handler. Three responsibilities:
//
//   1. Esc closes the modal. Capture phase beats every bubble-phase
//      listener — including the detail panel's useModalFocusTrap
//      Esc — so a single press dismisses ONLY the cheatsheet, not
//      the panel underneath. (Same pattern as
//      MatchScreenshotLightbox.)
//   2. j / ↓ scroll the modal body down; k / ↑ scroll it up
//      (matching the app-wide j = down / k = up convention).
//   3. Every other non-modifier, non-Tab key is swallowed via
//      stopImmediatePropagation so the app's global shortcuts
//      (g→m view nav, `/` search focus, etc.) can't fire from
//      behind the modal. The user asked: while the cheatsheet is
//      open, nothing should happen except scrolling or closing.
//
// Modified keys (Ctrl/Cmd/Alt) pass through untouched so browser
// shortcuts (Cmd+W, F5, etc.) still work; Tab stays untouched so
// the focus trap can move focus inside the modal.
const hasModifier = (e: KeyboardEvent) => e.ctrlKey || e.metaKey || e.altKey

// Keys the modal leaves entirely alone: Tab for the focus trap, bare
// modifier presses for the browser.
const PASSTHROUGH_KEYS = new Set(['Tab', 'Shift', 'Control', 'Alt', 'Meta'])

// preventDefault + stopImmediatePropagation + the action — the shape
// every handled key shares.
function absorb(e: KeyboardEvent, action: () => void) {
  e.preventDefault()
  e.stopImmediatePropagation()
  action()
}

function onCaptureKey(e: KeyboardEvent) {
  if (!props.open || hasModifier(e)) return

  switch (e.key) {
    case 'Escape':    absorb(e, () => emit('close')); return
    case 'j':
    case 'ArrowDown': absorb(e, () => nudgeScroll(SCROLL_STEP_PX)); return
    case 'k':
    case 'ArrowUp':   absorb(e, () => nudgeScroll(-SCROLL_STEP_PX)); return
  }
  if (PASSTHROUGH_KEYS.has(e.key)) return

  // Any other key: swallow so app shortcuts behind the modal don't
  // fire. Don't preventDefault — leave OS / browser defaults
  // (F-keys, screenshot keys, etc.) intact.
  e.stopImmediatePropagation()
}

// Install the capture-phase listener at mount, gated by `props.open`
// inside the handler. The earlier watch-based install raced the
// chunk's first evaluation: KeyboardShortcutsModal is a
// defineAsyncComponent, so when `?` flips `openCheatsheet` true the
// chunk loads, <script setup> runs with `props.open` already true,
// and `watch(() => props.open, cb)` (no `immediate: true`) tracks
// FUTURE changes only — the listener never installed for the first
// open. Pinned by keyboard-shortcuts.spec.ts:90 (CI-only failure on
// 2026-06-10's PR #253 run).
onMounted(() => {
  document.addEventListener('keydown', onCaptureKey, true)
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onCaptureKey, true)
})

function onOverlayClick() {
  emit('close')
}

// Binding catalog — data lives in the sibling keyboard-shortcuts.data
// module; this SFC only gates groups by the current context.
const visibleGroups = computed(() =>
  SHORTCUT_GROUPS.filter((g) => {
    // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- the default IS the rule here: every remaining context is a view id, shown when that view is current
    switch (g.context) {
      case 'always':
        return true
      case 'panel':
        return props.panelOpen
      case 'matches-no-panel':
        return props.view === 'matches' && !props.panelOpen
      case 'film-room':
        return props.view === 'reviews' && props.roomOpen
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
                  >{{ b.seq ? 'then' : 'or' }}</span>
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
  padding: var(--space-6);
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
  box-shadow: 0 24px 64px rgb(var(--shadow-rgb) / 55%);
}

.kbd-modal-header {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin-bottom: 1.1rem;
}

.kbd-modal-tag {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.3em;
  color: var(--accent-text);
  text-transform: uppercase;
}

.kbd-modal-title {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  /* stylelint-disable-next-line scale-unlimited/declaration-strict-value --
     the cheatsheet title, set in the condensed display face. It ramps
     across the --type-* ladder's top (1.5rem) into display scale
     (1.95rem), so it lands on no single stop by design. */
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
  font-size: var(--type-xs);
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
  font-size: var(--type-md);
  color: var(--text);
  line-height: 1.2;
}

.kbd-sep {
  font-family: var(--mono);
  font-size: var(--type-2xs);
  letter-spacing: 0.18em;
  color: var(--text-faint);
  text-transform: uppercase;
}

.kbd-action {
  margin: 0;
  font-size: var(--type-lg);
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
  font-size: var(--type-sm);
  color: var(--text-faint);
}

.kbd-fade-enter-active,
.kbd-fade-leave-active { transition: opacity var(--duration-med) ease; }

.kbd-fade-enter-from,
.kbd-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .kbd-fade-enter-active,
  .kbd-fade-leave-active {
    transition: none !important;
  }
}
</style>

<script setup lang="ts">
import { toRef } from 'vue'

import { useModalFocusTrap } from '../composables/useModalFocusTrap'

// "?" cheat-sheet modal. Lists every keyboard binding the app
// exposes — the new shortcuts AND the existing tablist arrows /
// Esc-dismiss / focus-trap Tab cycle — so users discovering one
// affordance learn about all of them.
//
// Visual register matches the OnboardingTour HUD direction: sharp
// 3px --accent left border, monospace <kbd> pills, Big-Noodle italic
// title. No background textures or animated chrome — every byte of
// scoped CSS counts against the 120 KB total-CSS budget. Group
// headings + a compact two-column key→action grid is the whole
// surface area.

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

// Mirror App.vue's modal pattern. The `open` prop is the
// canonical visibility ref; useModalFocusTrap reads it directly.
const openRef = toRef(props, 'open')
useModalFocusTrap(openRef, { containerSelector: '.kbd-modal-box' })

function onOverlayClick() {
  emit('close')
}

// Binding catalog. Grouped by scope so users see the cluster they're
// reading about. `keys` is the visual sequence (each item rendered
// as its own <kbd>); `action` is the descriptive label.
interface Binding {
  keys: readonly string[]
  action: string
}

interface BindingGroup {
  scope: string
  bindings: readonly Binding[]
}

const groups: readonly BindingGroup[] = [
  {
    scope: 'Global',
    bindings: [
      { keys: ['/'],            action: 'Focus the match-search input' },
      { keys: ['g', 'm'],       action: 'Go to Matches view' },
      { keys: ['g', 'i'],       action: 'Go to Parse view' },
      { keys: ['g', 's'],       action: 'Go to Settings view' },
      { keys: ['g', 'u'],       action: 'Go to Unknown view' },
      { keys: ['?'],            action: 'Show this cheatsheet' },
    ],
  },
  {
    scope: 'Matches view',
    bindings: [
      { keys: ['j'],            action: 'Focus the next match card' },
      { keys: ['k'],            action: 'Focus the previous match card' },
      { keys: ['e'],            action: 'Expand / collapse the focused card' },
      { keys: ['t'],            action: 'Focus the tags editor (auto-expands the card)' },
    ],
  },
  {
    scope: 'Tablist + modals',
    bindings: [
      { keys: ['←', '→'],      action: 'Cycle tabs (focus a tab button first)' },
      { keys: ['Home'],         action: 'First tab' },
      { keys: ['End'],          action: 'Last tab' },
      { keys: ['Tab'],          action: 'Cycle focusable elements (Shift+Tab reverses)' },
      { keys: ['Esc'],          action: 'Close the active modal / cheatsheet' },
    ],
  },
]
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
      <div class="kbd-modal-box">
        <header class="kbd-modal-header">
          <span class="kbd-modal-tag">CONTROLS</span>
          <h2 id="kbd-modal-title" class="kbd-modal-title">
            Keyboard shortcuts
          </h2>
        </header>

        <section
          v-for="group in groups"
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

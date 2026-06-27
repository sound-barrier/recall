<script setup lang="ts">
// Settings dialog — the ⌘, / app-menu / ⋮-kebab "Preferences" surface. A
// floating modal that mirrors the Settings tab's sections (SettingsSections is
// shared with SettingsView) so config is reachable without leaving the current
// view. The tab still exists; this is the duplicate quick-access path.
//
// A11y mirrors ManualMatchModal: role="dialog" + aria-modal + focus trap +
// Esc-to-close + return-focus. keepOpenOnFieldEscape so Esc in a Settings text
// input (profile rename / new-profile) blurs the field instead of closing.
import { toRef } from 'vue'
import { useModalFocusTrap } from '@/composables/shared/useModalFocusTrap'
import SettingsSections from '@/components/settings/SettingsSections.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

useModalFocusTrap(toRef(props, 'open'), {
  containerSelector: '.settings-modal-box',
  onClose: () => emit('close'),
  keepOpenOnFieldEscape: true,
})
</script>

<template>
  <Transition name="settings-modal">
    <div v-if="open" class="settings-modal-overlay" @click.self="$emit('close')">
      <aside
        class="settings-modal-box"
        data-settings-modal
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
      >
        <header class="settings-modal-head">
          <h2 id="settings-modal-title" class="settings-modal-title">
            Settings
          </h2>
          <button
            type="button"
            class="settings-modal-close"
            aria-label="Close settings (Esc)"
            @click="$emit('close')"
          >
            ×
          </button>
        </header>
        <div class="settings-modal-body settings">
          <SettingsSections />
        </div>
      </aside>
    </div>
  </Transition>
</template>

<style scoped>
.settings-modal-overlay {
  position: fixed;
  inset: 0;
  background: color-mix(in srgb, var(--bg) 70%, transparent);
  backdrop-filter: blur(6px);
  display: grid;
  place-items: start center;
  z-index: 1000;
  padding: 2.5rem 1.5rem;
  overflow-y: auto;
}

.settings-modal-box {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;

  /* Wide enough that the section rows (label column + the 4-up theme swatches /
     detect-binary controls) lay out as they do on the Settings tab, rather than
     squeezing the label column until its help text wraps word-per-word. */
  width: min(900px, 100%);
  box-shadow: 0 24px 60px color-mix(in srgb, var(--bg) 50%, transparent);
}

.settings-modal-head {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.9rem 1.3rem 0.6rem;
  background: var(--surface);
  border-bottom: 1px solid var(--border-soft);
}

.settings-modal-title {
  flex: 1 1 auto;
  font-family: var(--display);
  font-size: 1.5rem;
  font-weight: 400;
  letter-spacing: 0.06em;
  margin: 0;
  color: var(--text);
}

.settings-modal-close {
  appearance: none;
  border: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-dim);
  font-size: 1.1rem;
  width: 1.8rem;
  height: 1.8rem;
  border-radius: 2px;
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}

.settings-modal-close:hover {
  color: var(--text);
  border-color: var(--border-strong);
}

.settings-modal-body {
  padding: 1.3rem 1.4rem 1.6rem;
}

.settings-modal-enter-active,
.settings-modal-leave-active {
  transition: opacity 180ms ease;
}

.settings-modal-enter-from,
.settings-modal-leave-to {
  opacity: 0;
}

.settings-modal-enter-active .settings-modal-box,
.settings-modal-leave-active .settings-modal-box {
  transition: transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.settings-modal-enter-from .settings-modal-box,
.settings-modal-leave-to .settings-modal-box {
  transform: translateY(-12px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-modal-enter-active,
  .settings-modal-leave-active { transition: none; }

  .settings-modal-enter-active .settings-modal-box,
  .settings-modal-leave-active .settings-modal-box { transition: none; }
}
</style>

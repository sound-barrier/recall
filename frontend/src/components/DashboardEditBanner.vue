<script setup lang="ts">
// Edit-mode status bar that lights up at the top of the dossier
// while the user is in edit mode. Sets explicit expectations
// ("click to select, drag to move, trash to remove, + to add")
// so the affordances on the widgets read as a system rather than
// a guessing game.
//
// Visually: a thin accent stripe with a pulsing dot indicator,
// inline helper copy, and a dismissal button that emits `exit`.
// Sticks to the dossier above the row container; uses entrance/
// exit transitions to feel like a temporary mode rather than
// permanent chrome.
//
// Also hosts the Reset affordance. Reset is destructive (wipes
// every layout customization back to the install defaults), so
// it runs through a two-step inline confirm: first click arms
// the button, second click within RESET_CONFIRM_MS commits. A
// rogue first click auto-disarms after the window, and closing
// the banner cancels any pending arm.

import { ref, watch, onBeforeUnmount } from 'vue'

const props = defineProps<{
  open: boolean
}>()

const emit = defineEmits<{
  exit: []
  reset: []
}>()

const RESET_CONFIRM_MS = 3000
const resetArmed = ref(false)
let armTimer: ReturnType<typeof setTimeout> | null = null

function clearArmTimer() {
  if (armTimer !== null) {
    clearTimeout(armTimer)
    armTimer = null
  }
}

function disarm() {
  clearArmTimer()
  resetArmed.value = false
}

function onResetClick() {
  if (!resetArmed.value) {
    resetArmed.value = true
    clearArmTimer()
    armTimer = setTimeout(disarm, RESET_CONFIRM_MS)
    return
  }
  disarm()
  emit('reset')
}

// Closing the banner cancels any pending arm so the next time the
// user opens edit mode they start from idle.
watch(() => props.open, (next) => {
  if (!next) disarm()
})

onBeforeUnmount(clearArmTimer)
</script>

<template>
  <Transition name="dashboard-edit-banner">
    <div v-if="open" class="dashboard-edit-banner" role="status" aria-live="polite">
      <span class="dashboard-edit-banner-pulse" aria-hidden="true" />
      <span class="dashboard-edit-banner-label">Editing dashboard</span>
      <span class="dashboard-edit-banner-help">
        Click a widget to focus. Drag any widget to move it. <span aria-hidden="true">×</span> removes;
        <span aria-hidden="true">+</span> adds.
      </span>
      <button
        type="button"
        class="dashboard-edit-banner-reset"
        :class="{ 'dashboard-edit-banner-reset-armed': resetArmed }"
        :aria-label="resetArmed ? 'Confirm reset dashboard to defaults' : 'Reset dashboard to defaults'"
        data-edit-banner-reset
        @click="onResetClick"
      >
        {{ resetArmed ? 'Confirm reset?' : 'Reset' }}
      </button>
      <button
        type="button"
        class="dashboard-edit-banner-exit"
        data-edit-banner-exit
        @click="$emit('exit')"
      >
        Done
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.dashboard-edit-banner {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.4rem 0.85rem;
  margin-bottom: 0.55rem;
  border: 1px solid var(--accent);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  background:
    linear-gradient(90deg,
      color-mix(in srgb, var(--accent) 14%, transparent) 0%,
      color-mix(in srgb, var(--accent) 6%, transparent) 60%,
      transparent 100%);
  font-family: var(--mono);
  font-size: 0.68rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text);
}

.dashboard-edit-banner-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  flex: 0 0 auto;
  animation: dashboard-edit-banner-pulse 1.6s ease-in-out infinite;
}

@keyframes dashboard-edit-banner-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent) 80%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent) 0%, transparent); }
}

.dashboard-edit-banner-label {
  font-weight: 800;
  color: var(--accent);
}

.dashboard-edit-banner-help {
  font-size: 0.62rem;
  letter-spacing: 0.08em;
  text-transform: none;
  font-weight: 500;
  color: var(--text-dim);
  margin-left: auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dashboard-edit-banner-reset {
  appearance: none;
  border: 1px solid color-mix(in srgb, var(--accent) 50%, transparent);
  background: transparent;
  color: var(--text);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.32rem 0.65rem;
  border-radius: 2px;
  cursor: pointer;
  transition:
    background 140ms ease,
    border-color 140ms ease,
    color 140ms ease;
}

.dashboard-edit-banner-reset:hover {
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border-color: var(--accent);
}

.dashboard-edit-banner-reset:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

/* Armed = "Confirm reset?" state. Switches to a warning palette so
   the second click reads as the destructive action it is. Uses
   --loss (the W/L/D loss token) for the danger cue — already
   contrast-tuned per theme by the a11y rule. */
.dashboard-edit-banner-reset-armed {
  border-color: var(--loss);
  background: color-mix(in srgb, var(--loss) 14%, transparent);
  color: var(--loss);
  animation: dashboard-edit-banner-reset-pulse 1.4s ease-in-out infinite;
}

@keyframes dashboard-edit-banner-reset-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--loss) 40%, transparent); }
  50%      { box-shadow: 0 0 0 4px color-mix(in srgb, var(--loss) 0%, transparent); }
}

.dashboard-edit-banner-exit {
  appearance: none;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--surface);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.6rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  padding: 0.32rem 0.65rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}

.dashboard-edit-banner-exit:hover {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
  color: var(--surface);
}

.dashboard-edit-banner-exit:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

/* ── Slide-in/out ── */
.dashboard-edit-banner-enter-active,
.dashboard-edit-banner-leave-active {
  transition: opacity 200ms ease,
              transform 220ms cubic-bezier(0.2, 0.7, 0.3, 1),
              margin 220ms cubic-bezier(0.2, 0.7, 0.3, 1);
  overflow: hidden;
}

.dashboard-edit-banner-enter-from,
.dashboard-edit-banner-leave-to {
  opacity: 0;
  transform: translateY(-6px);
  margin-bottom: 0;
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-edit-banner-pulse { animation: none; }
  .dashboard-edit-banner-reset-armed { animation: none; }

  .dashboard-edit-banner-enter-active,
  .dashboard-edit-banner-leave-active { transition: none; }
}

@media (width <= 720px) {
  .dashboard-edit-banner-help { display: none; }
}
</style>

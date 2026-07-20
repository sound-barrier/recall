<script setup lang="ts">
import type { TiltNudgeSignal } from '@/match/match-momentum-helpers'

// The tilt nudge — a bottom-right toast when the latest ≥3 matches are
// all losses AND the streak K/D collapsed >25% below the 30-day
// baseline. Unlike the undo/anchor toasts it never auto-dismisses: a
// wellbeing suggestion that vanishes unseen is noise, one the user
// explicitly closes is a decision. Dismissal is session-scoped to the
// streak (useTiltNudge owns that).
defineProps<{
  signal: TiltNudgeSignal | null
}>()

const emit = defineEmits<{
  dismiss: []
}>()
</script>

<template>
  <Transition name="tilt-nudge">
    <div
      v-if="signal"
      class="tilt-nudge-toast"
      role="status"
      aria-live="polite"
    >
      <span class="tilt-nudge-copy">
        <strong>{{ signal.losses }} losses straight</strong> and your K/D is
        {{ signal.dropPercent }}% under your month — might be a good moment
        for a break.
      </span>
      <button
        type="button"
        class="tilt-nudge-dismiss"
        @click="emit('dismiss')"
      >
        Got it
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.tilt-nudge-toast {
  position: fixed;
  right: 1rem;
  bottom: 1rem;
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 0.8rem;
  max-width: 380px;
  padding: 0.65rem 0.8rem;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--loss);
  border-radius: 3px;
  box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 55%, transparent);
  font-size: 0.78rem;
  color: var(--text);
}

.tilt-nudge-copy strong {
  color: var(--loss);
}

.tilt-nudge-dismiss {
  appearance: none;
  flex-shrink: 0;
  font-family: var(--mono);
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  padding: 0.3rem 0.6rem;
  background: transparent;
  border: 1px solid var(--border-strong);
  border-radius: 2px;
  color: var(--text);
  cursor: pointer;
  transition: color 140ms ease, border-color 140ms ease;
}

.tilt-nudge-dismiss:hover,
.tilt-nudge-dismiss:focus-visible {
  border-color: var(--accent);
  color: var(--accent-text);
}

.tilt-nudge-enter-active,
.tilt-nudge-leave-active {
  transition: opacity 180ms ease, transform 180ms ease;
}

.tilt-nudge-enter-from,
.tilt-nudge-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

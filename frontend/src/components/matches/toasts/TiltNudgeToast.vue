<script setup lang="ts">
import type { TiltNudgeSignal } from '@/match/dossier/match-momentum-helpers'

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
  <Transition name="toast">
    <div
      v-if="signal"
      class="toast toast-notice tilt-nudge-toast"
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
        class="toast-dismiss tilt-nudge-dismiss"
        @click="emit('dismiss')"
      >
        Got it
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Rung: the floor. The loss tint is the point — this is the one toast
   that reports something going wrong. */
.tilt-nudge-toast {
  bottom: 1rem;
  max-width: min(30rem, 92vw);
  border-left-color: var(--loss);
}

.tilt-nudge-dismiss {
  flex-shrink: 0;
}

.tilt-nudge-copy strong {
  color: var(--loss);
}
</style>

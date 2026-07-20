<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import type { SessionSummary } from '@/match/match-momentum-helpers'

// Post-parse session tally — "Session so far: 3 matches · 2W-1L-0D".
// Mirrors MatchUndoToast's token/timer mechanics; informational, so it
// auto-dismisses.
const props = defineProps<{
  state: (SessionSummary & { token: number }) | null
}>()

const emit = defineEmits<{
  dismiss: [token: number]
}>()

const AUTO_DISMISS_MS = 6000

let timer: number | null = null

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

watch(() => props.state?.token ?? null, (tok) => {
  clearTimer()
  if (tok === null) return
  timer = window.setTimeout(() => {
    timer = null
    if (props.state && props.state.token === tok) emit('dismiss', tok)
  }, AUTO_DISMISS_MS)
}, { immediate: true })

onBeforeUnmount(clearTimer)
</script>

<template>
  <Transition name="session-toast">
    <div
      v-if="state"
      class="session-summary-toast"
      role="status"
      aria-live="polite"
    >
      <span class="sst-copy">
        Session so far: <strong>{{ state.matches }} match{{ state.matches === 1 ? '' : 'es' }}</strong>
        · {{ state.w }}W-{{ state.l }}L<template v-if="state.d">-{{ state.d }}D</template>
      </span>
      <button
        type="button"
        class="sst-dismiss"
        aria-label="Dismiss session summary"
        @click="state && emit('dismiss', state.token)"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.session-summary-toast {
  position: fixed;
  right: 1rem;
  bottom: 4.5rem; /* stacks above the tilt nudge / undo toasts */
  z-index: 1200;
  display: flex;
  align-items: center;
  gap: 0.7rem;
  padding: 0.55rem 0.75rem;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--accent);
  border-radius: var(--radius-md);
  box-shadow: 0 12px 32px color-mix(in srgb, var(--bg) 55%, transparent);
  font-size: var(--type-md);
  color: var(--text);
}

.sst-copy strong {
  color: var(--accent-text);
}

.sst-dismiss {
  appearance: none;
  border: 1px solid var(--border-soft);
  background: transparent;
  color: var(--text-dim);
  width: 1.5rem;
  height: 1.5rem;
  border-radius: var(--radius);
  cursor: pointer;
  transition: color var(--duration-fast) ease, border-color var(--duration-fast) ease;
}

.sst-dismiss:hover,
.sst-dismiss:focus-visible {
  color: var(--text);
  border-color: var(--border-strong);
}

.session-toast-enter-active,
.session-toast-leave-active {
  transition: opacity var(--duration-prompt) ease, transform var(--duration-prompt) ease;
}

.session-toast-enter-from,
.session-toast-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
</style>

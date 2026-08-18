<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import type { SessionSummary } from '@/match/dossier/match-momentum-helpers'
import { signJudgment } from '@/match/trends/match-heatmap-helpers'

// Post-parse session tally — "Session so far: 3 matches · 2W-1L · +18%".
//
// It does NOT auto-dismiss after a few seconds any more, and that is the whole
// point of this surface. The watcher debounces for 60 seconds before parsing,
// so the toast appears about a minute after the match ends — by which time the
// player is back in Overwatch, alt-tabbed away. A six-second toast fired then
// was one almost nobody ever saw, with no way to get it back.
//
// It now stays until the user dismisses it or the SESSION itself goes stale,
// which is what makes it the "sticky element during a play session" without
// adding a fourth place that spells the same tally (the masthead scoreboard,
// the by-session grouping and the dossier already spell it).
const props = defineProps<{
  state: (SessionSummary & { token: number }) | null
}>()

const emit = defineEmits<{
  dismiss: [token: number]
}>()

let timer: number | null = null

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

// Armed from the session's own expiry rather than a fixed delay: the session
// ends when the gap since the newest match elapses, so that is when a "session
// so far" readout stops being true.
watch(() => props.state?.token ?? null, (tok) => {
  clearTimer()
  if (tok === null || !props.state) return
  const ms = props.state.endsAt - Date.now()
  if (ms <= 0) {
    emit('dismiss', tok)
    return
  }
  timer = window.setTimeout(() => {
    timer = null
    if (props.state && props.state.token === tok) emit('dismiss', tok)
  }, ms)
}, { immediate: true })

onBeforeUnmount(clearTimer)

// The session's rank movement, with what it was built from. Absent entirely
// when no capture in the session reported one — a session whose pills went
// unread has an unknown movement, not a flat one.
const movement = computed(() => {
  const st = props.state
  if (!st || st.readCount === 0) return null
  const signed = `${st.netPercent > 0 ? '+' : ''}${st.netPercent}%`
  return {
    text: signed,
    // The sign is carried in the text, but the tint is not the only cue for a
    // screen reader either (WCAG 1.4.1).
    name: `${signed} rank this session — ${signJudgment(st.netPercent)}`,
    partial: st.readCount < st.matches ? `${st.readCount}/${st.matches} read` : '',
  }
})
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
        <template v-if="movement">
          · <span class="sst-move" role="img" :aria-label="movement.name">{{ movement.text }}</span>
          <span v-if="movement.partial" class="sst-partial">({{ movement.partial }})</span>
        </template>
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
.sst-move {
  font-weight: 700;
}

/* Muted, and --text-dim not --text-mute: mute drops below AA on Day's darker
   surfaces and this is small content text. */
.sst-partial {
  font-size: var(--type-2xs);
  color: var(--text-dim);
}

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

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from 'vue'
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
// the by-session grouping and the dossier already spell it). Dismissal sticks
// to the session — see useParseRunLifecycle — so "×" is not undone by the next
// game.
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

// The longest single hop the timer takes before re-checking the wall clock.
//
// `endsAt` is an absolute instant, but setTimeout counts elapsed AWAKE time —
// it does not advance while the machine is suspended. Armed as one long delay,
// a toast raised at 22:55 with a three-hour session gap was still on screen the
// next morning if the machine slept overnight, still saying "session so far"
// about last night's games. Re-checking the real time every few minutes makes
// the expiry self-correct across a sleep, and it also keeps every delay well
// inside setTimeout's 32-bit ceiling, past which the browser fires immediately
// and the toast would blink out instead.
const MAX_HOP_MS = 60_000

// Armed from the session's own expiry rather than a fixed delay: the session
// ends when the gap since the newest match elapses, so that is when a "session
// so far" readout stops being true.
function armExpiry(tok: number) {
  clearTimer()
  if (!props.state || props.state.token !== tok) return
  const remaining = props.state.endsAt - Date.now()
  if (remaining <= 0) {
    emit('dismiss', tok)
    return
  }
  timer = window.setTimeout(() => {
    timer = null
    armExpiry(tok)
  }, Math.min(remaining, MAX_HOP_MS))
}

watch(() => props.state?.token ?? null, (tok) => {
  clearTimer()
  if (tok === null) return
  armExpiry(tok)
}, { immediate: true })

// A wake or a tab-return is the moment the wall clock and the timer are most
// likely to disagree, so re-check immediately rather than waiting out the hop.
function recheckOnWake() {
  if (document.visibilityState === 'visible' && props.state) armExpiry(props.state.token)
}

onMounted(() => { document.addEventListener('visibilitychange', recheckOnWake) })
onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', recheckOnWake)
  clearTimer()
})

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
  <Transition name="toast">
    <div
      v-if="state"
      class="toast toast-notice session-summary-toast"
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
        class="toast-close"
        aria-label="Dismiss session summary"
        @click="state && emit('dismiss', state.token)"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Rung: above the tilt nudge, below the focus nudge. */
.session-summary-toast {
  bottom: 4.5rem;
}

.sst-move {
  font-weight: 700;
}

/* Muted, and --text-dim not --text-mute: mute drops below AA on Day's darker
   surfaces and this is small content text. */
.sst-partial {
  font-size: var(--type-2xs);
  color: var(--text-dim);
}

.sst-copy strong {
  color: var(--accent-text);
}
</style>

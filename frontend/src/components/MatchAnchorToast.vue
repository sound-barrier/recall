<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'

// Confirmation toast that fires when the "since this match" anchor
// changes — set (with the match's "date · map" label + a "View
// filter" action button that hops to the narrow panel) or cleared
// (just confirmation). Bridges the cause-effect gap between the
// detail panel's anchor button (where the change happens) and the
// narrow panel's filter toggle (where the consequence lives), so
// the user can see WHY the dossier might be about to change.
//
// `state.token` is the React-style fresh-key — App.vue bumps it on
// every transition so re-triggering the toast restarts the
// auto-dismiss countdown.

const props = defineProps<{
  state: {
    kind: 'set' | 'cleared'
    label: string
    token: number
  } | null
}>()

const emit = defineEmits<{
  'view-filter': []
  dismiss:       [token: number]
}>()

const AUTO_DISMISS_MS = 4500

let timer: number | null = null

function clearTimer() {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
}

function startTimer() {
  clearTimer()
  const tok = props.state?.token ?? null
  if (tok === null) return
  timer = window.setTimeout(() => {
    timer = null
    if (props.state && props.state.token === tok) {
      emit('dismiss', tok)
    }
  }, AUTO_DISMISS_MS)
}

watch(() => props.state?.token ?? null, (tok) => {
  if (tok === null) {
    clearTimer()
    return
  }
  startTimer()
}, { immediate: true })

onBeforeUnmount(clearTimer)

function onView() {
  emit('view-filter')
}

function onDismiss() {
  const tok = props.state?.token
  clearTimer()
  if (tok !== undefined) emit('dismiss', tok)
}

const headline = computed(() => {
  if (!props.state) return ''
  return props.state.kind === 'set' ? 'Reference set' : 'Reference cleared'
})
</script>

<template>
  <Teleport to="body">
    <Transition name="match-anchor-toast">
      <div
        v-if="state"
        class="match-anchor-toast"
        role="status"
        aria-live="polite"
        data-anchor-toast
      >
        <span class="match-anchor-toast-glyph" aria-hidden="true">{{ state.kind === 'set' ? '◆' : '◇' }}</span>
        <span class="match-anchor-toast-body">
          <span class="match-anchor-toast-eyebrow">{{ headline }}</span>
          <span v-if="state.kind === 'set'" class="match-anchor-toast-name">{{ state.label }}</span>
          <span v-else class="match-anchor-toast-sub">filter cleared</span>
        </span>
        <button
          v-if="state.kind === 'set'"
          type="button"
          class="match-anchor-toast-action"
          data-anchor-toast-view
          @click="onView"
        >
          View filter
        </button>
        <button
          type="button"
          class="match-anchor-toast-dismiss"
          aria-label="Dismiss anchor confirmation"
          data-anchor-toast-dismiss
          @click="onDismiss"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.match-anchor-toast {
  position: fixed;
  right: 1.4rem;
  bottom: 5.4rem;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.85rem 0.75rem;
  min-width: 280px;
  max-width: min(420px, 92vw);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 24px 48px -24px rgb(0 0 0 / 50%);
  z-index: 110;
  isolation: isolate;
}

.match-anchor-toast-glyph {
  font-family: var(--mono);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
}

.match-anchor-toast-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.match-anchor-toast-eyebrow {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.match-anchor-toast-name {
  font-family: var(--display);
  font-style: italic;
  font-size: 0.95rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.match-anchor-toast-sub {
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-dim);
  text-transform: lowercase;
  letter-spacing: 0.02em;
}

.match-anchor-toast-action {
  appearance: none;
  border: 1px solid var(--accent);
  background: var(--accent);
  color: var(--surface);
  font-family: var(--mono);
  font-weight: 700;
  font-size: 0.6rem;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  padding: 0.4rem 0.85rem;
  border-radius: 2px;
  cursor: pointer;
  transition: background 140ms ease;
}

.match-anchor-toast-action:hover {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
}

.match-anchor-toast-action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.match-anchor-toast-dismiss {
  appearance: none;
  background: transparent;
  border: 0;
  color: var(--text-faint);
  font-family: var(--mono);
  font-size: 0.95rem;
  cursor: pointer;
  padding: 0.15rem 0.3rem;
  line-height: 1;
  transition: color 140ms ease;
}

.match-anchor-toast-dismiss:hover { color: var(--text); }

.match-anchor-toast-dismiss:focus-visible {
  outline: none;
  color: var(--accent);
}

/* ── Slide-in / slide-out ── */
.match-anchor-toast-enter-active,
.match-anchor-toast-leave-active {
  transition: opacity 200ms ease,
              transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.match-anchor-toast-enter-from,
.match-anchor-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .match-anchor-toast-enter-active,
  .match-anchor-toast-leave-active { transition: none; }
}
</style>

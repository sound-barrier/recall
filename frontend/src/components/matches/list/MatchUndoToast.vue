<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'

// Inline "Undo" toast for hiding a match. Hiding moves the match to the archive
// drawer (easy to miss), so this bottom-right toast offers a one-click un-hide
// before it auto-dismisses. Mirrors MatchAnchorToast's timer/token mechanics;
// `state.token` is the fresh key the composable bumps per hide so a back-to-back
// hide restarts the countdown.

const props = defineProps<{
  state: { label: string; token: number } | null
}>()

const emit = defineEmits<{
  undo:    []
  dismiss: [token: number]
}>()

// A touch longer than the anchor toast (4.5s) — an undo needs reaction time.
const AUTO_DISMISS_MS = 6000

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
    if (props.state && props.state.token === tok) emit('dismiss', tok)
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

function onUndo() {
  clearTimer()
  emit('undo')
}

function onDismiss() {
  const tok = props.state?.token
  clearTimer()
  if (tok !== undefined) emit('dismiss', tok)
}
</script>

<template>
  <Teleport to="body">
    <Transition name="match-undo-toast">
      <div
        v-if="state"
        class="match-undo-toast"
        role="status"
        aria-live="polite"
        data-undo-toast
      >
        <span class="match-undo-toast-glyph" aria-hidden="true">⊘</span>
        <span class="match-undo-toast-body">
          <span class="match-undo-toast-eyebrow">Match hidden</span>
          <span class="match-undo-toast-name">{{ state.label }}</span>
        </span>
        <button
          type="button"
          class="match-undo-toast-action"
          data-undo-toast-undo
          @click="onUndo"
        >
          Undo
        </button>
        <button
          type="button"
          class="match-undo-toast-dismiss"
          aria-label="Dismiss hidden-match notice"
          data-undo-toast-dismiss
          @click="onDismiss"
        >
          <span aria-hidden="true">×</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.match-undo-toast {
  position: fixed;
  right: 1.4rem;
  bottom: 1.4rem;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.85rem 0.75rem;
  min-width: 280px;
  max-width: min(420px, 92vw);
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 24px 48px -24px rgb(0 0 0 / 50%);
  z-index: 110;
  isolation: isolate;
}

.match-undo-toast-glyph {
  font-size: 1.05rem;
  color: var(--text-faint);
  line-height: 1;
}

.match-undo-toast-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.match-undo-toast-eyebrow {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.match-undo-toast-name {
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

.match-undo-toast-action {
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

.match-undo-toast-action:hover {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
}

.match-undo-toast-action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.match-undo-toast-dismiss {
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

.match-undo-toast-dismiss:hover { color: var(--text); }

.match-undo-toast-dismiss:focus-visible {
  outline: none;
  color: var(--accent);
}

.match-undo-toast-enter-active,
.match-undo-toast-leave-active {
  transition: opacity 200ms ease,
              transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.match-undo-toast-enter-from,
.match-undo-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .match-undo-toast-enter-active,
  .match-undo-toast-leave-active { transition: none; }
}
</style>

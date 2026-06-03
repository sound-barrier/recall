<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

// Undo-after-trash toast. Pops up bottom-right when a widget is
// removed from the dashboard; counts down a 6-second window during
// which the user can hit "Undo" to bring the widget back into the
// same row + index it lived in before. Hovering the toast pauses the
// countdown so users get a fair shot at reading + clicking it.
//
// State is fully driven by the `trashed` prop — the parent owns the
// undo registry. Emitting `undo` tells the parent to re-add; emitting
// `dismiss` tells the parent to drop the pending undo (used both by
// the X button and by the auto-expire).

const props = defineProps<{
  // Latest widget trashed. The parent emits a fresh object reference
  // every time, including for back-to-back trashes of the same id.
  trashed: {
    id: string
    eyebrow: string
    row: number
    idx: number
    // Used as the React-style "key" so re-trashing the same id resets
    // the countdown on a fresh object.
    token: number
  } | null
}>()

const emit = defineEmits<{
  undo:    [token: number]
  dismiss: [token: number]
}>()

const DURATION_MS = 6000

const remainingMs = ref(DURATION_MS)
const paused      = ref(false)
let timer: number | null = null
let lastTick = 0

const visible = computed(() => props.trashed !== null && remainingMs.value > 0)

function clearTimer() {
  if (timer !== null) {
    window.clearInterval(timer)
    timer = null
  }
}

function startTimer() {
  clearTimer()
  lastTick = Date.now()
  remainingMs.value = DURATION_MS
  timer = window.setInterval(() => {
    if (paused.value) {
      lastTick = Date.now()
      return
    }
    const now = Date.now()
    remainingMs.value = Math.max(0, remainingMs.value - (now - lastTick))
    lastTick = now
    if (remainingMs.value === 0) {
      clearTimer()
      if (props.trashed) emit('dismiss', props.trashed.token)
    }
  }, 100)
}

// `immediate: true` so a toast that's mounted with a non-null
// trashed prop (the common case) kicks off its countdown immediately
// rather than waiting for the next change of the token ref.
watch(() => props.trashed?.token ?? null, (token) => {
  if (token === null) {
    clearTimer()
    remainingMs.value = 0
    return
  }
  startTimer()
}, { immediate: true })

onBeforeUnmount(clearTimer)

function onUndo() {
  if (!props.trashed) return
  const token = props.trashed.token
  clearTimer()
  emit('undo', token)
}

function onDismiss() {
  if (!props.trashed) return
  const token = props.trashed.token
  clearTimer()
  emit('dismiss', token)
}

const progressPct = computed(() => Math.round((remainingMs.value / DURATION_MS) * 100))
</script>

<template>
  <Teleport to="body">
    <Transition name="dashboard-undo-toast">
      <div
        v-if="visible && trashed"
        class="dashboard-undo-toast"
        role="status"
        aria-live="polite"
        data-undo-toast
        @mouseenter="paused = true"
        @mouseleave="paused = false"
        @focusin="paused = true"
        @focusout="paused = false"
      >
        <span class="dashboard-undo-toast-glyph" aria-hidden="true">↶</span>
        <span class="dashboard-undo-toast-body">
          <span class="dashboard-undo-toast-eyebrow">Removed</span>
          <span class="dashboard-undo-toast-name">{{ trashed.eyebrow }}</span>
        </span>
        <button
          type="button"
          class="dashboard-undo-toast-action"
          data-undo-action
          @click="onUndo"
        >
          Undo
        </button>
        <button
          type="button"
          class="dashboard-undo-toast-dismiss"
          aria-label="Dismiss undo prompt"
          data-undo-dismiss
          @click="onDismiss"
        >
          <span aria-hidden="true">×</span>
        </button>
        <span
          class="dashboard-undo-toast-progress"
          aria-hidden="true"
          :style="{ width: progressPct + '%' }"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.dashboard-undo-toast {
  position: fixed;
  right: 1.4rem;
  bottom: 1.4rem;
  display: grid;
  grid-template-columns: auto 1fr auto auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.7rem 0.85rem 0.85rem;
  min-width: 280px;
  max-width: min(420px, 92vw);
  background: var(--surface);
  border: 1px solid var(--accent);
  border-left: 3px solid var(--accent);
  border-radius: 2px;
  box-shadow: 0 24px 48px -24px rgb(0 0 0 / 50%);
  z-index: 110;
  overflow: hidden;
  isolation: isolate;
}

.dashboard-undo-toast-glyph {
  font-family: var(--mono);
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--accent);
  line-height: 1;
}

.dashboard-undo-toast-body {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dashboard-undo-toast-eyebrow {
  font-family: var(--mono);
  font-size: 0.55rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--text-faint);
  font-weight: 700;
}

.dashboard-undo-toast-name {
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

.dashboard-undo-toast-action {
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

.dashboard-undo-toast-action:hover {
  background: color-mix(in srgb, var(--accent) 80%, var(--text));
}

.dashboard-undo-toast-action:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent);
}

.dashboard-undo-toast-dismiss {
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

.dashboard-undo-toast-dismiss:hover { color: var(--text); }

.dashboard-undo-toast-dismiss:focus-visible {
  outline: none;
  color: var(--accent);
}

.dashboard-undo-toast-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  transition: width 100ms linear;
}

/* ── Slide-in / slide-out ── */
.dashboard-undo-toast-enter-active,
.dashboard-undo-toast-leave-active {
  transition: opacity 200ms ease,
              transform 240ms cubic-bezier(0.2, 0.7, 0.3, 1);
}

.dashboard-undo-toast-enter-from,
.dashboard-undo-toast-leave-to {
  opacity: 0;
  transform: translateY(12px);
}

@media (prefers-reduced-motion: reduce) {
  .dashboard-undo-toast-enter-active,
  .dashboard-undo-toast-leave-active { transition: none; }
}
</style>

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
    <Transition name="toast-undo">
      <div
        v-if="visible && trashed"
        class="toast toast-undo dashboard-undo-toast"
        role="status"
        aria-live="polite"
        data-undo-toast
        @mouseenter="paused = true"
        @mouseleave="paused = false"
        @focusin="paused = true"
        @focusout="paused = false"
      >
        <span class="toast-glyph toast-glyph-mark" aria-hidden="true">↶</span>
        <span class="toast-body">
          <span class="eyebrow">Removed</span>
          <span class="toast-name">{{ trashed.eyebrow }}</span>
        </span>
        <button
          type="button"
          class="toast-action"
          data-undo-action
          @click="onUndo"
        >
          Undo
        </button>
        <button
          type="button"
          class="toast-close-plain"
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
/* Rung: the floor — this one is raised from the dashboard, never beside
   the match list's own undo. `overflow: hidden` clips the countdown bar
   to the toast's rounded corner; the extra bottom padding is its track. */
.dashboard-undo-toast {
  bottom: 1.4rem;
  padding-bottom: 0.85rem;
  border-color: var(--accent);
  overflow: hidden;
}

.dashboard-undo-toast-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--accent);
  transition: width var(--duration-instant) linear;
}
</style>

<style src="@/components/shared/toasts.css"></style>

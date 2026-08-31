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
    <Transition name="toast-undo">
      <div
        v-if="state"
        class="toast toast-undo match-undo-toast"
        role="status"
        aria-live="polite"
        data-undo-toast
      >
        <span class="toast-glyph" aria-hidden="true">⊘</span>
        <span class="toast-body">
          <span class="eyebrow">Match hidden</span>
          <span class="toast-name">{{ state.label }}</span>
        </span>
        <button
          type="button"
          class="toast-action"
          data-undo-toast-undo
          @click="onUndo"
        >
          Undo
        </button>
        <button
          type="button"
          class="toast-close-plain"
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
/* Rung: the floor of the ladder. Everything else is the shared toast
   family in styles/toasts.css. */
.match-undo-toast {
  bottom: 1.4rem;
}
</style>

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
    <Transition name="toast-undo">
      <div
        v-if="state"
        class="toast toast-undo match-anchor-toast"
        role="status"
        aria-live="polite"
        data-anchor-toast
      >
        <span class="toast-glyph toast-glyph-mark" aria-hidden="true">{{ state.kind === 'set' ? '◆' : '◇' }}</span>
        <span class="toast-body">
          <span class="eyebrow">{{ headline }}</span>
          <span v-if="state.kind === 'set'" class="toast-name">{{ state.label }}</span>
          <span v-else class="toast-sub">filter cleared</span>
        </span>
        <button
          v-if="state.kind === 'set'"
          type="button"
          class="toast-action"
          data-anchor-toast-view
          @click="onView"
        >
          View filter
        </button>
        <button
          type="button"
          class="toast-close-plain"
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
/* Rung: above the undo bar, which fires from the same list. The accent
   border marks a confirmation rather than a reversible action. */
.match-anchor-toast {
  bottom: 5.4rem;
  border-color: var(--accent);
}
</style>

<style src="@/components/shared/toasts.css"></style>

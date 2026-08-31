<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import type { ParseRunSummary } from '@/components/ingest/parse-progress'
import { useAppStore } from '@/stores/app'

// End-of-run outcome — "4 read · 2 failed to read", from the
// parse-complete payload rather than a refetched ledger (which cannot
// tell this run's failures from standing degraded rows). Rendered as an
// app-level toast because the watcher can finish a run while the user
// is on any tab; "View failed" is the door to the Unknown tab's triage
// when anything failed. Auto-dismisses — a run report is transient, and
// the Failed section keeps the durable record.
const props = defineProps<{
  state: (ParseRunSummary & { token: number }) | null
}>()

const emit = defineEmits<{
  dismiss: [token: number]
}>()

const appStore = useAppStore()

const AUTO_DISMISS_MS = 12_000
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
    emit('dismiss', tok)
  }, AUTO_DISMISS_MS)
}, { immediate: true })

onBeforeUnmount(clearTimer)

function onViewFailed(token: number) {
  void appStore.goToView('unknown')
  emit('dismiss', token)
}
</script>

<template>
  <Transition name="toast">
    <div
      v-if="state"
      class="toast toast-notice parse-outcome-toast"
      role="status"
      aria-live="polite"
    >
      <span class="pot-copy">
        Parse finished — <strong>{{ state.files_parsed }} read</strong>
        <template v-if="state.files_failed > 0">
          · <span class="pot-failed">{{ state.files_failed }} failed to read</span>
        </template>
      </span>
      <button
        v-if="state.files_failed > 0"
        type="button"
        class="empty-link pot-view"
        @click="onViewFailed(state.token)"
      >
        View failed →
      </button>
      <button
        type="button"
        class="toast-close"
        aria-label="Dismiss parse outcome"
        @click="state && emit('dismiss', state.token)"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
/* Rung: the top of the ladder. All four notices can fire off one
   completed parse, and the focus nudge renders later at the same
   z-index — an 8rem outcome toast would be painted over. */
.parse-outcome-toast {
  bottom: 13rem;
}

.pot-copy strong {
  color: var(--accent-text);
}

.pot-failed {
  font-weight: 700;
  color: var(--loss);
}

.pot-view {
  flex-shrink: 0;
}
</style>

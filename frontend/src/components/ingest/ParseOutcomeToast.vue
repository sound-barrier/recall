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
  <Transition name="parse-outcome">
    <div
      v-if="state"
      class="parse-outcome-toast"
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
        class="pot-dismiss"
        aria-label="Dismiss parse outcome"
        @click="state && emit('dismiss', state.token)"
      >
        ×
      </button>
    </div>
  </Transition>
</template>

<style scoped>
.parse-outcome-toast {
  position: fixed;
  right: 1rem;

  /* Above the session tally's slot (4.5rem) — both can raise on one
     parse-complete, and two fixed toasts must not overlap. */
  bottom: 8rem;
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

.pot-dismiss {
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

.pot-dismiss:hover,
.pot-dismiss:focus-visible {
  color: var(--text);
  border-color: var(--border-strong);
}

.parse-outcome-enter-active,
.parse-outcome-leave-active {
  transition: opacity var(--duration-prompt) ease, transform var(--duration-prompt) ease;
}

.parse-outcome-enter-from,
.parse-outcome-leave-to {
  opacity: 0;
  transform: translateY(0.4rem);
}
</style>

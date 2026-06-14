<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ParseProgressEvent } from '@/components/ParseProgressPanel.vue'

const props = defineProps<{
  parseProgress: ParseProgressEvent | null
}>()

const emit = defineEmits<{
  'go-to-view': [next: 'ingest']
}>()

// The chip surfaces while a parse run is in flight and stays a beat
// after the closing tick so the user catches the final 47 / 47. The
// settle window is component-owned so callers don't have to manage
// the timer; it cancels on a new run picking up.
const SETTLE_MS = 1500

const inFlight = computed(() => {
  const p = props.parseProgress
  return !!p && p.total > 0 && p.done < p.total
})

const armed = ref(false)
let settleTimer: ReturnType<typeof setTimeout> | null = null

watch(inFlight, (now, was) => {
  if (now) {
    if (settleTimer) { clearTimeout(settleTimer); settleTimer = null }
    armed.value = true
    return
  }
  if (was) {
    armed.value = true
    if (settleTimer) clearTimeout(settleTimer)
    settleTimer = setTimeout(() => { armed.value = false; settleTimer = null }, SETTLE_MS)
  }
})

const visible = computed(() => inFlight.value || armed.value)

const done = computed(() => props.parseProgress?.done ?? 0)
const total = computed(() => props.parseProgress?.total ?? 0)
const pct = computed(() => {
  const t = total.value
  if (t <= 0) return 0
  return Math.min(100, Math.max(0, Math.round((done.value / t) * 100)))
})
</script>

<template>
  <button
    v-if="visible"
    type="button"
    class="masthead-parse-chip"
    :title="`Parsing ${done} of ${total} screenshots — open Parse tab`"
    aria-label="Parse queue progress — open Parse tab"
    @click="emit('go-to-view', 'ingest')"
  >
    <span class="mpc-dot" aria-hidden="true" />
    <span class="mpc-label">PARSING</span>
    <span
      class="mpc-counter"
      role="progressbar"
      :aria-valuemin="0"
      :aria-valuemax="total"
      :aria-valuenow="done"
    >
      <span class="mpc-done">{{ done }}</span>
      <span class="mpc-slash" aria-hidden="true">/</span>
      <span class="mpc-total">{{ total }}</span>
    </span>
    <span class="mpc-track" aria-hidden="true">
      <span class="mpc-fill" :style="{ width: pct + '%' }" />
    </span>
  </button>
</template>

<style scoped>
.masthead-parse-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.65rem;
  background: var(--surface-2);
  border: 1px solid var(--accent-soft);
  border-radius: 3px;
  font-family: var(--mono, ui-monospace, 'SF Mono', menlo, monospace);
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  transition: background 140ms ease, border-color 140ms ease;
}

.masthead-parse-chip:hover {
  background: color-mix(in srgb, var(--accent) 8%, var(--surface-2));
  border-color: var(--accent);
}

.mpc-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent-glow);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.mpc-label {
  font-weight: 600;
  letter-spacing: 0.18em;
  color: var(--accent-text);
}

.mpc-counter {
  display: inline-flex;
  align-items: baseline;
  gap: 2px;
  font-family: var(--mono);
  font-feature-settings: 'tnum' on, 'lnum' on;
}

.mpc-done   { color: var(--accent); font-weight: 600; }
.mpc-slash  { color: var(--text-faint); opacity: 0.6; padding: 0 1px; }
.mpc-total  { color: var(--text-faint); }

.mpc-track {
  display: block;
  width: 56px;
  height: 4px;
  background: var(--surface-3);
  border-radius: 2px;
  overflow: hidden;
}

.mpc-fill {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 220ms cubic-bezier(0.3, 0, 0.2, 1);
}

@media (prefers-reduced-motion: reduce) {
  .mpc-dot { animation: none; }
  .mpc-fill { transition: none; }
}
</style>

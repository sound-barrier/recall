<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { ParseProgressEvent } from './ParseProgressPanel.vue'

const props = defineProps<{
  parseProgress: ParseProgressEvent | null
  parseLog: ParseProgressEvent[]
}>()

const emit = defineEmits<{
  'go-to-view': [next: 'settings' | 'ingest' | 'matches' | 'unknown']
}>()

// Tactical-status-bar gist:
//   - visible when a parse is in flight (parseProgress non-null AND
//     done < total), or for a 1.5 s "grace" tail after the final
//     tick so the user can read the closing 23 / 23.
//   - slides off-bottom after grace via a transform on the root
//     element (scoped style below). Reduced-motion zeroes the
//     transition via the global :where rule.
//   - clicking anywhere on the bar except the explicit dismiss
//     affordance jumps to the Ingest tab for the detailed log view.

// `visible` drives the slide-in. `armed` flips false 1.5 s after
// the parse completes; if a new parse starts before the timer
// fires we cancel it.
const armed = ref(false)
let dismissTimer: ReturnType<typeof setTimeout> | null = null

const inFlight = computed(() => {
  const p = props.parseProgress
  return !!p && p.total > 0 && p.done < p.total
})

const visible = computed(() => inFlight.value || armed.value)

watch(inFlight, (now, was) => {
  if (now) {
    // New parse run picked up — cancel any in-progress dismiss and
    // raise the bar.
    if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null }
    armed.value = true
    return
  }
  if (was) {
    // Parse just finished; arm a 1.5 s grace before sliding away.
    armed.value = true
    if (dismissTimer) clearTimeout(dismissTimer)
    dismissTimer = setTimeout(() => { armed.value = false; dismissTimer = null }, 1500)
  }
})

const done = computed(() => props.parseProgress?.done ?? 0)
const total = computed(() => props.parseProgress?.total ?? 0)
const currentFile = computed(() => props.parseProgress?.filename ?? '')
const currentType = computed(() => props.parseProgress?.screenshot_type ?? '')

// Zero-padded counter so digit width doesn't bounce as the count grows.
const counterPad = computed(() => Math.max(2, String(total.value).length))
const doneText = computed(() => String(done.value).padStart(counterPad.value, '0'))
const totalText = computed(() => String(total.value).padStart(counterPad.value, '0'))

// 20 segmented ticks, filled in order. The most-recently-filled
// tick gets a glow class for one animation cycle so the user can
// see motion even when the counter ticks once.
const TICK_COUNT = 20
const fillIndex = computed(() => {
  if (total.value <= 0) return 0
  return Math.min(TICK_COUNT, Math.round((done.value / total.value) * TICK_COUNT))
})
const ticks = computed(() => {
  const out: Array<{ filled: boolean; active: boolean }> = []
  const fi = fillIndex.value
  for (let i = 0; i < TICK_COUNT; i++) {
    out.push({ filled: i < fi, active: i === fi - 1 })
  }
  return out
})

// Per-shot tick: ms between the last two parseLog entries. Gives a
// visual sense of OCR pace. The log entries arrive in order; we just
// take the wall-clock delta. (parseLog itself doesn't carry a
// timestamp — we sample Date.now() when the event lands by tracking
// the last-seen done count and the timestamp at that change.)
const lastTickMs = ref<number | null>(null)
let lastDone = 0
let lastTickAt = 0
watch(done, (now) => {
  const t = performance.now()
  if (now > lastDone) {
    if (lastTickAt !== 0) {
      lastTickMs.value = Math.round(t - lastTickAt)
    }
    lastTickAt = t
    lastDone = now
  } else if (now === 0) {
    // New batch started — reset.
    lastDone = 0
    lastTickAt = 0
    lastTickMs.value = null
  }
})

const lastTickLabel = computed(() => {
  const ms = lastTickMs.value
  if (ms === null) return ''
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)} s`
  return `${ms} ms`
})

function onJumpToIngest(e: MouseEvent) {
  // Don't intercept clicks on the dismiss affordance if added later.
  if ((e.target as HTMLElement | null)?.closest('[data-no-jump]')) return
  emit('go-to-view', 'ingest')
}
</script>

<template>
  <aside
    class="status-bar"
    :class="{ 'status-bar-hidden': !visible }"
    :aria-hidden="visible ? undefined : 'true'"
    :inert="visible ? undefined : true"
    role="status"
    aria-live="polite"
    @click="onJumpToIngest"
  >
    <!-- pulse + label group -->
    <div class="group group-status">
      <span class="dot" aria-hidden="true" />
      <span class="label">INGESTING</span>
    </div>

    <span class="rule" aria-hidden="true" />

    <!-- counter + segmented ticks -->
    <div class="group group-counter">
      <span class="counter">
        <span class="counter-done">{{ doneText }}</span>
        <span class="counter-slash" aria-hidden="true">/</span>
        <span class="counter-total">{{ totalText }}</span>
      </span>
      <span
        class="ticks"
        role="progressbar"
        aria-label="Parse progress"
        :aria-valuemin="0"
        :aria-valuemax="total"
        :aria-valuenow="done"
      >
        <span
          v-for="(tick, i) in ticks"
          :key="i"
          class="tick"
          :class="{ 'tick-filled': tick.filled, 'tick-active': tick.active }"
        />
      </span>
    </div>

    <span class="rule" aria-hidden="true" />

    <!-- current file + type -->
    <div class="group group-file" :title="currentFile">
      <span v-if="currentType" class="type-tag">{{ currentType }}</span>
      <span class="filename">{{ currentFile || '…' }}</span>
    </div>

    <span class="rule" aria-hidden="true" />

    <!-- per-shot tick (right-aligned via flex) -->
    <div class="group group-tick">
      <span class="tick-label">{{ lastTickLabel || '—' }}</span>
    </div>
  </aside>
</template>

<style scoped>
/* Tactical status bar — broadcast-control-room ticker.
   Sharp, brutalist, secondary to content above. */

.status-bar {
  position: fixed;
  inset: auto 0 0;
  height: 44px;
  z-index: 40;
  display: flex;
  align-items: stretch;
  gap: 0;
  padding: 0 18px;
  background: var(--surface-3);
  border-top: 1px solid var(--accent);
  box-shadow: 0 -8px 24px -10px rgb(0 0 0 / 50%);
  font-family: var(--mono, ui-monospace, 'SF Mono', menlo, monospace);
  cursor: pointer;
  user-select: none;

  /* slide-in is the default; slide-off applied via .status-bar-hidden */
  transform: translateY(0);
  transition: transform 240ms cubic-bezier(0.3, 0, 0.2, 1);
  will-change: transform;
}

.status-bar-hidden {
  transform: translateY(100%);
  pointer-events: none;
}

.status-bar:hover {
  background: color-mix(in oklab, var(--surface-3) 92%, var(--accent) 8%);
}

/* Each group is a horizontal slot with vertical centering. The rules
   between groups give the "broadcast HUD" segmented look. */
.group {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
}

.rule {
  display: block;
  width: 1px;
  background: var(--surface-2);
  margin: 8px 0;
}

/* --- group 1: pulse + label --- */

.dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
  animation: pulse-dot 1.2s ease-in-out infinite;
}

.label {
  font-family: var(--mono, ui-monospace, monospace);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.16em;
  color: var(--accent-text);
  text-transform: uppercase;
}

/* --- group 2: counter + ticks --- */

.group-counter {
  flex: 0 0 auto;
}

.counter {
  display: inline-flex;
  align-items: baseline;
  gap: 4px;
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', 'Russo One', sans-serif;
  font-size: 22px;
  line-height: 1;
  letter-spacing: 0.04em;
  font-feature-settings: 'tnum' on, 'lnum' on;
}

.counter-done { color: var(--accent); }
.counter-slash { color: var(--text-faint); opacity: 0.6; }
.counter-total { color: var(--text-faint); }

.ticks {
  display: grid;
  grid-template-columns: repeat(20, 6px);
  gap: 3px;
  align-items: center;
}

.tick {
  display: block;
  width: 6px;
  height: 16px;
  background: transparent;
  border: 1px solid var(--text-faint);
  border-radius: 1px;
}

.tick-filled {
  background: var(--accent);
  border-color: var(--accent);
}

.tick-active {
  animation: tick-glow 360ms ease-out;
}

@keyframes tick-glow {
  0%   { box-shadow: 0 0 0 0 var(--accent-glow); transform: scaleY(1); }
  40%  { box-shadow: 0 0 10px 2px var(--accent-glow); transform: scaleY(1.15); }
  100% { box-shadow: 0 0 0 0 transparent; transform: scaleY(1); }
}

/* --- group 3: current file --- */

.group-file {
  flex: 1 1 auto;
  min-width: 0; /* let the filename truncate */
  gap: 10px;
}

.type-tag {
  flex: 0 0 auto;
  font-family: var(--mono);
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--accent-text);
  background: var(--accent-soft);
  padding: 3px 6px 2px;
  border-radius: 2px;
}

.filename {
  flex: 1 1 auto;
  font-family: var(--mono);
  font-size: 12px;
  color: var(--text-faint);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* --- group 4: per-shot tick --- */

.group-tick {
  flex: 0 0 auto;
  min-width: 60px;
  justify-content: flex-end;
}

.tick-label {
  font-family: var(--mono);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.06em;
  color: var(--text-faint);
}

/* Light-theme overrides — match the cream/orange palette without
   the dark-mode glow. Need :global because scoped styles can't pierce
   the [data-theme="light"] selector on <html> by default. */
:global([data-theme="light"]) .status-bar {
  background: var(--surface-2);
  border-top: 1px solid var(--accent);
  box-shadow: 0 -8px 24px -12px rgb(0 0 0 / 12%);
}

:global([data-theme="light"]) .rule {
  background: var(--surface-3);
}

:global([data-theme="light"]) .dot {
  box-shadow: 0 0 8px var(--accent-glow);
}

/* Reduced motion: slide-in/out instant; tick glow off. The global
   media query in app.css already collapses transitions; this scoped
   block makes sure the keyframes don't run. */
@media (prefers-reduced-motion: reduce) {
  .status-bar { transition: none; }
  .dot { animation: none; }
  .tick-active { animation: none; }
}
</style>

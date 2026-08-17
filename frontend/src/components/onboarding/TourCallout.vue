<script setup lang="ts">
import { computed } from 'vue'

import type { CalloutPlacement } from '@/composables/onboarding/useOnboardingTour'
import { useFloatingCallout } from '@/composables/onboarding/useFloatingCallout'
import { computeConnector } from '@/components/onboarding/tour-callout-helpers'

// Anchored callout panel. Renders the step's tag / number / heading
// / body plus the Skip / Back / Next controls. Anchors to the
// spotlighted target — or centers in the viewport when no target
// exists (Welcome / Done).
//
// Auto-placement: when placement is 'auto' (default for unspecified
// steps), the callout tries bottom → right → left → top in order,
// picking the first side with enough room to fit. A SAFETY_MARGIN
// keeps the callout off the viewport edges.
//
// A dashed connector line draws from the callout toward the target.
// Drawn as an SVG path with `stroke-dasharray` for the brutalist /
// tactical aesthetic — matches the viewfinder corner brackets the
// spotlight component owns.

const props = defineProps<{
  // CSS selector of the spotlighted target. The callout reads this
  // for placement geometry; if null/empty the callout centers.
  target: string | null | undefined
  // Preferred placement; auto picks the side with the most room.
  placement?: CalloutPlacement
  // Step metadata for rendering. Owned by useOnboardingTour.
  eyebrow:   string
  num:       string
  heading:   string
  body:      string
  // Counter copy ("3 of 12").
  counter:   string
  // Skip-ahead pips: total step count + the ACTIVE zero-based index.
  stepCount: number
  stepIndex: number
  // Button state.
  canBack:   boolean
  isLast:    boolean
}>()

const emit = defineEmits<{
  back:   []
  next:   []
  skip:   []
  finish: []
  jump: [index: number]
}>()

const CALLOUT_W = 360
// Min CALLOUT_H is dynamic — we estimate from the actual rendered
// height after mount. Until then we pick a reasonable default for
// initial placement calculations.
const CALLOUT_H_INITIAL = 200
const SAFETY = 16
const GAP    = 22  // gap between target and callout

// Positioning + drag engine — auto-placement, the settle-wait that
// absorbs the target's enter transition, scroll/resize resyncs, and
// the header-drag state machine all live in the composable. The SFC
// re-syncs on heading changes too (in-place step swaps).
const {
  calloutEl,
  pos,
  posReady,
  dragging,
  getTargetRect,
  calloutHeight,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
} = useFloatingCallout({
  target: () => props.target,
  placement: () => props.placement,
  resyncSignals: () => [props.heading],
  dims: { calloutW: CALLOUT_W, calloutHInitial: CALLOUT_H_INITIAL, safety: SAFETY, gap: GAP },
})

// Connector geometry — a dashed line from the callout's anchor edge
// toward the target's center. The edge-picking math is pure and lives in
// tour-callout-helpers next to the placement solver; this only supplies
// the live measurements.
const connector = computed(() => computeConnector(getTargetRect(), {
  left: pos.value.left,
  top:  pos.value.top,
  w:    CALLOUT_W,
  h:    calloutHeight(),
}))
</script>

<template>
  <div
    ref="calloutEl"
    class="tour-callout"
    :class="{ 'tour-callout-ready': posReady }"
    :data-placement="pos.placement"
    :style="{ left: `${pos.left}px`, top: `${pos.top}px`, width: `${CALLOUT_W}px` }"
    role="dialog"
    aria-modal="false"
    aria-labelledby="tour-callout-heading"
  >
    <header
      class="tour-callout-head"
      :class="{ 'tour-callout-head-dragging': dragging }"
      title="Drag to move"
      @pointerdown="onDragPointerDown"
      @pointermove="onDragPointerMove"
      @pointerup="onDragPointerUp"
      @pointercancel="onDragPointerUp"
    >
      <span class="tour-callout-drag-handle" aria-hidden="true">⋮⋮</span>
      <span class="eyebrow accent tour-callout-eyebrow">{{ eyebrow }}</span>
      <span class="tour-callout-counter">{{ counter }}</span>
      <nav class="tour-pips" aria-label="Jump to tour step">
        <button
          v-for="i in stepCount"
          :key="i"
          type="button"
          class="tour-pip"
          :class="{ active: i - 1 === stepIndex }"
          :aria-current="i - 1 === stepIndex ? 'step' : undefined"
          :aria-label="`Go to step ${i} of ${stepCount}`"
          @pointerdown.stop
          @mousedown.stop
          @click.stop="emit('jump', i - 1)"
        />
      </nav>
    </header>
    <div class="tour-callout-body-block">
      <div class="tour-callout-num" aria-hidden="true">
        {{ num }}
      </div>
      <h2 id="tour-callout-heading" class="tour-callout-heading">
        {{ heading }}
      </h2>
    </div>
    <p class="tour-callout-body">
      {{ body }}
    </p>
    <footer class="tour-callout-actions">
      <button
        type="button"
        class="tour-callout-skip"
        @click="emit('skip')"
      >
        Skip tour
      </button>
      <div class="tour-callout-actions-primary">
        <button
          type="button"
          class="btn ghost"
          :disabled="!canBack"
          @click="emit('back')"
        >
          Previous
        </button>
        <button
          type="button"
          class="btn primary tour-callout-next"
          @click="isLast ? emit('finish') : emit('next')"
        >
          {{ isLast ? 'Done' : 'Next' }}
          <span class="tour-callout-next-arrow" aria-hidden="true">→</span>
        </button>
      </div>
    </footer>
  </div>

  <!-- Connector line from the callout toward the target's center.
       Drawn as a full-viewport SVG so the absolute coords match the
       callout's own viewport positioning. -->
  <svg
    v-if="connector"
    class="tour-callout-connector"
    aria-hidden="true"
    xmlns="http://www.w3.org/2000/svg"
  >
    <line
      :x1="connector.x1"
      :y1="connector.y1"
      :x2="connector.x2"
      :y2="connector.y2"
      stroke="var(--accent)"
      stroke-width="1"
      stroke-dasharray="4 5"
      stroke-linecap="round"
      opacity="0.5"
    />
    <circle
      :cx="connector.x1"
      :cy="connector.y1"
      r="3"
      fill="var(--accent)"
    />
  </svg>
</template>

<style scoped>
.tour-callout {
  position: fixed;
  z-index: 2002;
  pointer-events: auto;
  background: var(--surface);
  border: 1px solid var(--border);
  border-left: 3px solid var(--accent);
  padding: 1.05rem 1.15rem 0.85rem;
  box-shadow:
    0 26px 70px rgb(var(--shadow-rgb) / 60%),
    0 0 0 1px color-mix(in srgb, var(--accent) 18%, transparent);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;

  /* Stay invisible until syncPos's settle wait completes (the
     `tour-callout-ready` modifier flips on). The transition: left/
     top declaration lives ONLY on `.tour-callout-ready` so that
     the FIRST application of the computed position is an instant
     snap, not a var(--duration-slow) glide from (0, 0). On subsequent updates
     (window resize, target rect change), the class is already
     present and the transitions animate normally. */
  opacity: 0;
}

.tour-callout-ready {
  opacity: 1;
  animation: tour-callout-in 320ms cubic-bezier(0.18, 1, 0.32, 1) both;
  transition: opacity var(--duration-med) ease var(--duration-instant), left var(--duration-slow) ease, top var(--duration-slow) ease;
}

@keyframes tour-callout-in {
  from { transform: translateY(6px) scale(0.985); }
  to   { transform: translateY(0)   scale(1); }
}

.tour-callout-head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: var(--space-2);

  /* The header doubles as the drag handle. cursor: grab telegraphs
     it without needing a label; cursor: grabbing flips while the
     pointer is captured. user-select: none so a quick drag doesn't
     accidentally start a text selection on the eyebrow/counter. */
  cursor: grab;
  user-select: none;
  touch-action: none;
}

.tour-callout-head-dragging { cursor: grabbing; }

.tour-callout-drag-handle {
  font-family: var(--mono);
  font-size: var(--type-3xs);
  letter-spacing: -0.1em;
  color: var(--text-faint);
  margin-right: 0.15rem;
  opacity: 0.7;
}

.tour-pips {
  display: inline-flex;
  gap: 0.3rem;
  margin-left: 0.55rem;
}

/* Skip-ahead jump points — the linear order stays the default flow,
   the pips just stop forcing it. */
.tour-pip {
  appearance: none;
  width: 0.5rem;
  height: 0.5rem;
  padding: 0;
  border: 1px solid var(--border-strong);
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  transition: background var(--duration-fast) ease, border-color var(--duration-fast) ease, transform var(--duration-fast) ease;
}

.tour-pip:hover,
.tour-pip:focus-visible {
  border-color: var(--accent);
  transform: scale(1.15);
}

.tour-pip.active {
  background: var(--accent);
  border-color: var(--accent);
}

.tour-callout-counter {
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.18em;
  color: var(--text-faint);
  font-feature-settings: "tnum";
}

.tour-callout-body-block {
  display: grid;
  grid-template-columns: auto 1fr;
  align-items: end;
  column-gap: var(--space-3);
  margin-top: 0.05rem;
}

.tour-callout-num {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-size: 3.2rem;
  line-height: 0.82;
  color: var(--accent-text);

  /* Tilt that mirrors the masthead wordmark. Subtle — keeps
     proportions readable. */
  transform: translateY(0.06em);
}

.tour-callout-heading {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  font-size: var(--type-5xl);
  line-height: 1.05;
  color: var(--text);
  margin: 0;
  border-bottom: 2px solid var(--accent);
  padding-bottom: 0.35rem;
  align-self: end;
}

.tour-callout-body {
  margin: 0;
  color: var(--text-dim);
  font-size: var(--type-lg);
  line-height: 1.55;
}

.tour-callout-actions {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 0.55rem;
  padding-top: 0.7rem;
  border-top: 1px dashed color-mix(in srgb, var(--text-faint) 38%, transparent);
}

.tour-callout-actions-primary {
  display: inline-flex;
  gap: 0.4rem;
}

.tour-callout-skip {
  background: transparent;
  border: 0;
  padding: 0.35rem 0.1rem;
  font-family: var(--mono);
  font-size: var(--type-xs);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
}

.tour-callout-skip:hover { color: var(--text-dim); }

.tour-callout-skip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.tour-callout-next-arrow { margin-left: 0.35em; }

.tour-callout-connector {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 2001;
}

/* Centered (no-target) callout — slightly wider, no connector visible,
   skip the slide-from-side animation in favor of a pure fade-up. */
.tour-callout[data-placement='auto'] {
  width: min(440px, calc(100vw - 2 * 16px)) !important;
}

@media (prefers-reduced-motion: reduce) {
  .tour-callout {
    animation: none;
    transition: none;
  }
}
</style>

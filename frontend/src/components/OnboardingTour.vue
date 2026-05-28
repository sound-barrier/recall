<script setup lang="ts">
import { computed, watch } from 'vue'

import {
  useOnboardingTour,
  ONBOARDING_STEPS,
  type OnboardingViewId,
} from '../composables/useOnboardingTour'
import { useModalFocusTrap } from '../composables/useModalFocusTrap'

// First-launch onboarding briefing. Renders as a full-viewport HUD
// overlay (asymmetric panel — vertical progress rail on the left,
// numbered step content on the right) instead of a centred modal.
// The aesthetic intentionally evokes a pre-match objective briefing
// in OW itself, matching the existing Recall display-font + accent-
// orange + monospace-eyebrow vocabulary used across the masthead,
// MatchCard headers and Settings section labels. Decisions:
//
//   - Big Noodle Too Oblique for the step number + heading (the
//     same family the masthead uses); it carries the most aesthetic
//     weight in the panel.
//   - Vertical "ult-charge" segmented progress rail on the left, with
//     a "01 / 04" counter at the foot. Active segment scans in;
//     completed segments stay lit at 50%.
//   - Monospace eyebrow tag ("BRIEFING" / "OBJECTIVE N") for the
//     HUD/industrial register.
//   - Step transitions: 280ms slide-from-right + opacity. The
//     heading underline draws in over 360ms. All animations gated by
//     `prefers-reduced-motion`.
//
// A11y: useModalFocusTrap installs the Tab-cycle + Escape-dismiss
// keyboard contract. The container is `role="dialog"` +
// `aria-modal="true"` + `aria-labelledby="onboarding-title"`. Click-
// to-dismiss only on the overlay self (NOT on the panel) per WCAG
// modal patterns.

const tour = useOnboardingTour()
useModalFocusTrap(tour.open, { containerSelector: '.onboarding-panel' })

const emit = defineEmits<{
  navigate: [view: OnboardingViewId]
}>()

// When the active step has an associated view, drive the real
// underlying Recall tab to match. The watch fires AFTER the
// stepIndex updates, so the tour copy and the visible tab stay
// synchronised through every Next / Back press.
watch(() => tour.stepIndex.value, (idx) => {
  const v = ONBOARDING_STEPS[idx]?.viewId
  if (v) emit('navigate', v)
})

// Per-segment state for the left rail. `done` = a step the user has
// already moved past (lit at 50%); `active` = current step (lit +
// scan animation); `future` = ahead (outline only).
const segments = computed(() =>
  ONBOARDING_STEPS.map((s, i) => ({
    num: s.num,
    state:
      i < tour.stepIndex.value ? 'done'
      : i === tour.stepIndex.value ? 'active'
      : 'future',
  })),
)

const pad2 = (n: number) => String(n).padStart(2, '0')

function onOverlayClick() {
  // Background-click is a dismissal affordance; treat it like Skip
  // so the completion flag persists.
  tour.skip()
}

function onPrimaryClick() {
  if (tour.isLastStep.value) tour.finish()
  else tour.next()
}
</script>

<template>
  <transition name="onboarding-fade">
    <div
      v-if="tour.open.value"
      class="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
      data-testid="onboarding-tour"
      @click.self="onOverlayClick"
    >
      <div class="onboarding-panel">
        <!-- ── Left rail: ult-charge progress + step counter ── -->
        <aside class="onboarding-rail" aria-hidden="true">
          <div class="rail-mark">
            ↳ ONBOARDING
          </div>
          <ol class="rail-segments">
            <li
              v-for="(seg, i) in segments"
              :key="i"
              class="rail-segment"
              :class="`rail-segment-${seg.state}`"
            >
              <span class="rail-segment-num">{{ seg.num }}</span>
              <span class="rail-segment-bar" />
            </li>
          </ol>
          <div class="rail-counter">
            <span class="rail-counter-cur">{{ pad2(tour.stepNumber.value) }}</span>
            <span class="rail-counter-sep">/</span>
            <span class="rail-counter-total">{{ pad2(tour.totalSteps) }}</span>
          </div>
        </aside>

        <!-- ── Step content (re-mounts on stepIndex change so the
             slide + underline animations replay) ── -->
        <div :key="tour.stepIndex.value" class="onboarding-step">
          <div class="step-tag">
            {{ tour.step.value.tag }}
          </div>
          <div class="step-num" aria-hidden="true">
            {{ tour.step.value.num }}
          </div>
          <h2 id="onboarding-title" class="step-heading">
            {{ tour.step.value.heading }}
          </h2>
          <p class="step-body">
            {{ tour.step.value.body }}
          </p>
        </div>

        <!-- ── Actions: skip (low-priority) + back/next/done ── -->
        <div class="onboarding-actions">
          <button
            type="button"
            class="onboarding-skip"
            @click="tour.skip"
          >
            Skip tour
          </button>
          <div class="onboarding-actions-primary">
            <button
              type="button"
              class="btn ghost"
              :disabled="tour.isFirstStep.value"
              @click="tour.prev"
            >
              Back
            </button>
            <button
              type="button"
              class="btn primary onboarding-next"
              @click="onPrimaryClick"
            >
              {{ tour.isLastStep.value ? 'Done' : 'Next' }}
              <span class="onboarding-next-arrow" aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
/* HUD briefing overlay. Asymmetric grid: ult-charge progress rail
   on the left, giant Big-Noodle step number + monospace eyebrow on
   the right. Decoration trimmed aggressively to stay inside the
   total-CSS budget (CI enforces 120kB) — the visual register comes
   from the typography + accent border, not from background
   textures or animated chrome. */

.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: grid;
  place-items: center;
  padding: 2rem;
  background: color-mix(in srgb, var(--bg) 90%, transparent);
}

.onboarding-panel {
  width: min(820px, 100%);
  display: grid;
  grid-template-columns: minmax(7rem, 12rem) 1fr;
  column-gap: 1.6rem;
  background: var(--surface);
  border: 1px solid var(--surface-3);
  border-left: 3px solid var(--accent);
  padding: 2rem 2.2rem 1.6rem 1.6rem;
  box-shadow: 0 26px 70px rgb(0 0 0 / 55%);
}

.onboarding-rail {
  grid-row: 1 / 3;
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  padding-right: 1rem;
  border-right: 1px dashed color-mix(in srgb, var(--accent) 22%, var(--text-faint));
}

.rail-mark {
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  color: var(--accent);
}

.rail-segments {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.rail-segment {
  display: grid;
  grid-template-columns: 2.4em 1fr;
  align-items: center;
  gap: 0.4rem;
  font-family: var(--mono);
  font-size: 0.7rem;
  color: var(--text-faint);
}

.rail-segment-bar {
  display: block;
  height: 4px;
  background: color-mix(in srgb, var(--text-faint) 28%, transparent);
}

.rail-segment-done .rail-segment-num,
.rail-segment-active .rail-segment-num { color: var(--accent); }

.rail-segment-done .rail-segment-bar {
  background: color-mix(in srgb, var(--accent) 55%, transparent);
}

.rail-segment-active .rail-segment-bar { background: var(--accent); }

.rail-counter {
  margin-top: auto;
  font-family: var(--mono);
  font-size: 0.85rem;
  color: var(--text-faint);
}

.rail-counter-cur { color: var(--accent); }
.rail-counter-sep { opacity: 0.6; padding: 0 0.2em; }

.onboarding-step {
  grid-column: 2;
  grid-row: 1;
  display: flex;
  flex-direction: column;
  gap: 0.3rem;
  animation: step-slide 240ms ease-out;
}

@keyframes step-slide {
  from { opacity: 0; transform: translateX(8px); }
  to   { opacity: 1; transform: translateX(0); }
}

.step-tag {
  font-family: var(--mono);
  font-size: 0.64rem;
  letter-spacing: 0.3em;
  color: var(--accent);
  text-transform: uppercase;
}

.step-num {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-size: clamp(3.2rem, 6vw, 5rem);
  line-height: 0.9;
  color: var(--accent);
  margin: 0.05em 0;
}

.step-heading {
  font-family: 'Big Noodle Too Oblique', 'Barlow Condensed', Impact, sans-serif;
  font-weight: 400;
  font-size: clamp(1.4rem, 2.2vw, 1.85rem);
  line-height: 1.05;
  color: var(--text);
  margin: 0;
  border-bottom: 2px solid var(--accent);
  padding-bottom: 0.4rem;
  align-self: flex-start;
}

.step-body {
  margin: 0.5rem 0 0;
  color: var(--text-dim);
  font-size: 0.95rem;
  line-height: 1.55;
  max-width: 48ch;
}

.onboarding-actions {
  grid-column: 2;
  grid-row: 2;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 1.4rem;
  padding-top: 0.85rem;
  border-top: 1px dashed color-mix(in srgb, var(--text-faint) 38%, transparent);
}

.onboarding-actions-primary { display: inline-flex; gap: 0.5rem; }

.onboarding-skip {
  background: transparent;
  border: 0;
  padding: 0.4rem 0.2rem;
  font-family: var(--mono);
  font-size: 0.72rem;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--text-faint);
  cursor: pointer;
}

.onboarding-skip:hover { color: var(--text-dim); }

.onboarding-skip:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.onboarding-next-arrow { margin-left: 0.35em; }

.onboarding-fade-enter-active,
.onboarding-fade-leave-active { transition: opacity 220ms ease; }

.onboarding-fade-enter-from,
.onboarding-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .onboarding-step,
  .onboarding-fade-enter-active,
  .onboarding-fade-leave-active {
    animation: none !important;
    transition: none !important;
  }
}
</style>

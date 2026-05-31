<script setup lang="ts">
import { computed, watch, onUnmounted } from 'vue'

import {
  useOnboardingTour,
  ONBOARDING_STEPS,
  type OnboardingViewId,
  type TourActionContext,
} from '../composables/useOnboardingTour'
import TourSpotlight from './TourSpotlight.vue'
import TourCallout from './TourCallout.vue'

// First-launch onboarding tour. Spotlighted, step-by-step product
// walkthrough — see useOnboardingTour.ts for the step list, the
// composable's design notes, and the gate semantics.
//
// Composition:
//   - <TourSpotlight> draws the SVG mask cutout + viewfinder corner
//     brackets that ring the current step's target.
//   - <TourCallout> anchors the briefing panel to the target with
//     a dashed connector line.
//   - This file owns the controller (`useOnboardingTour`), the
//     keyboard handlers (Esc / Enter / ←/→ / h/l), and the parent-
//     facing emits that drive App.vue's view changes + records
//     swap.
//
// Focus management: the callout panel is the active dialog. The
// previous static-modal implementation used useModalFocusTrap; the
// spotlighted callout doesn't need a trap because (a) the dim
// overlay blocks click interactions with the page underneath, and
// (b) Esc and Enter are the only required keyboard moves — both
// captured here. The Next button is focused on every step change so
// keyboard-only users move through the tour by pressing Enter.

const emit = defineEmits<{
  navigate:    [view: OnboardingViewId]
  // Tour-active state — App.vue swaps records.value for the demo
  // corpus while this is true.
  'active-change': [active: boolean]
  // App.vue passes these in via TourActionContext setters so the
  // tour can drive the detail panel + narrow popover + filters.
  // Emitting them lets the tour stay decoupled from App.vue's
  // `selection` / `matchesNarrowState` plumbing.
  'open-match':         [matchKey: string]
  'close-match':        []
  'open-narrow':        []
  'close-narrow':       []
  'apply-hero-filter':  [hero: string]
  'clear-filters':      []
}>()

const actions: TourActionContext = {
  goToView:        (v) => emit('navigate', v),
  openMatch:       (k) => emit('open-match', k),
  closeMatch:      () => emit('close-match'),
  openNarrow:      () => emit('open-narrow'),
  closeNarrow:     () => emit('close-narrow'),
  applyHeroFilter: (h) => emit('apply-hero-filter', h),
  clearFilters:    () => emit('clear-filters'),
}

const tour = useOnboardingTour({ actions })

// Per-step copy: tag defaults to "OBJECTIVE N", num is the two-digit
// step index. The Welcome / Done steps override tag with "BRIEFING"
// / "BRIEFING COMPLETE" — that override is carried in the step data
// itself.
const eyebrow = computed(() =>
  tour.step.value.tag ?? `OBJECTIVE ${tour.stepNumber.value}`,
)
const num = computed(() => String(tour.stepNumber.value).padStart(2, '0'))
const counter = computed(() =>
  `${String(tour.stepNumber.value).padStart(2, '0')} / ${String(tour.totalSteps).padStart(2, '0')}`,
)

// Keyboard contract — registered at document level (capture phase)
// so the tour absorbs navigation keys before the panel underneath
// can react. ←/h step back, →/l step forward, Enter advances, Esc
// dismisses.
function onKeydown(e: KeyboardEvent) {
  if (!tour.open.value) return
  const target = document.activeElement as HTMLElement | null
  const tag = target?.tagName ?? ''
  const inEditable = tag === 'INPUT' || tag === 'TEXTAREA' || !!target?.isContentEditable
  // Don't intercept in an input — the user can type "h" in a search
  // box without ending the tour.
  if (inEditable) return

  if (e.key === 'Escape') {
    e.preventDefault()
    e.stopImmediatePropagation()
    tour.skip()
    return
  }
  if (e.key === 'Enter') {
    e.preventDefault()
    e.stopImmediatePropagation()
    if (tour.isLastStep.value) tour.finish()
    else void tour.next()
    return
  }
  if (e.key === 'ArrowRight' || e.key === 'l') {
    e.preventDefault()
    e.stopImmediatePropagation()
    void tour.next()
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'h') {
    e.preventDefault()
    e.stopImmediatePropagation()
    void tour.prev()
    return
  }
}

// Body scroll lock — set on open, restored on close. Prevents the
// user from scrolling the underlying page out from under the
// spotlighted target while a step is being talked about. Tour
// internals still use scrollIntoView() to bring the next target into
// view; that's a programmatic call and is unaffected by the
// overflow:hidden lock on body.
let savedBodyOverflow = ''
let savedHtmlOverflow = ''
function lockBodyScroll() {
  savedBodyOverflow = document.body.style.overflow
  savedHtmlOverflow = document.documentElement.style.overflow
  document.body.style.overflow = 'hidden'
  document.documentElement.style.overflow = 'hidden'
}
function unlockBodyScroll() {
  document.body.style.overflow = savedBodyOverflow
  document.documentElement.style.overflow = savedHtmlOverflow
}

// Install / remove the document keydown listener on open transitions
// so a closed tour doesn't intercept site-wide keys. Capture-phase
// for the same reason MatchScreenshotLightbox uses it — the tour
// outranks the panel's prev/next-match handler.
watch(tour.open, (isOpen, wasOpen) => {
  if (isOpen && !wasOpen) {
    document.addEventListener('keydown', onKeydown, true)
    lockBodyScroll()
    emit('active-change', true)
    // If the first step has a view associated, drive the underlying
    // app to it. The composable's restart() handles this, but the
    // automatic on-mount open does not.
    const first = ONBOARDING_STEPS[0]
    if (first?.view) emit('navigate', first.view)
  }
  if (!isOpen && wasOpen) {
    document.removeEventListener('keydown', onKeydown, true)
    unlockBodyScroll()
    emit('active-change', false)
  }
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown, true)
  // Defensive: if the component unmounts while the tour is still
  // open (route-level teardown), make sure we leave the page in a
  // scrollable state.
  if (tour.open.value) unlockBodyScroll()
})

function onSkip()   { tour.skip() }
function onFinish() { tour.finish() }
function onNext()   { void tour.next() }
function onBack()   { void tour.prev() }
</script>

<template>
  <transition name="onboarding-fade">
    <div
      v-if="tour.open.value"
      class="onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-callout-heading"
      data-testid="onboarding-tour"
    >
      <!-- Atmospheric noise + diagonal hairlines behind everything,
           gating it as a "training mode" register rather than a plain
           dark scrim. The spotlight SVG layers on top and dims the
           rest. -->
      <div class="tour-atmos" aria-hidden="true" />

      <!-- HUD marker at the top-left so the user always knows they're
           IN a tour — protects against the "is this real or is this
           a tutorial?" ambiguity. -->
      <div class="tour-marker" aria-hidden="true">
        <span class="tour-marker-rune">↳</span>
        <span class="tour-marker-text">TOUR MODE · DEMO DATA</span>
      </div>

      <TourSpotlight
        :target="tour.step.value.target ?? null"
        :padding="tour.step.value.padding"
      />

      <!-- :key on the wrapper ensures the callout slide animation
           replays on every step change. -->
      <TourCallout
        :key="tour.step.value.id"
        :target="tour.step.value.target ?? null"
        :placement="tour.step.value.placement ?? 'auto'"
        :eyebrow="eyebrow"
        :num="num"
        :heading="tour.step.value.heading"
        :body="tour.step.value.body"
        :counter="counter"
        :can-back="!tour.isFirstStep.value"
        :is-last="tour.isLastStep.value"
        @back="onBack"
        @next="onNext"
        @skip="onSkip"
        @finish="onFinish"
      />
    </div>
  </transition>
</template>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 1999;

  /* Children (spotlight at 2000, connector at 2001, callout at 2002)
     stack INSIDE this overlay. The overlay itself blocks pointer
     events so the underlying app isn't accidentally clickable
     between the cutout and the callout. */
  pointer-events: auto;
}

/* Atmospheric texture — concentric subtle gradients + diagonal
   pinstripes. Sits beneath the spotlight at z-index 0 of the
   overlay. */
.tour-atmos {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background:
    radial-gradient(60% 50% at 8% -10%, color-mix(in srgb, var(--accent, #d96a2e) 16%, transparent), transparent 60%),
    radial-gradient(45% 40% at 100% 110%, color-mix(in srgb, var(--accent, #d96a2e) 10%, transparent), transparent 60%),
    repeating-linear-gradient(120deg, transparent 0 14px, rgb(255 255 255 / 1.2%) 14px 15px);
  opacity: 0.6;
}

/* HUD marker — top-left badge. Brutalist monospace label so the
   user always reads "tour" in their peripheral vision. */
.tour-marker {
  position: fixed;
  top: 0.95rem;
  left: 1.1rem;
  z-index: 2003;
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.32rem 0.7rem 0.3rem 0.45rem;
  background: rgb(0 0 0 / 65%);
  border: 1px solid var(--border, #3a3a3a);
  border-left: 2px solid var(--accent, #d96a2e);
  font-family: var(--mono);
  font-size: 0.62rem;
  letter-spacing: 0.22em;
  color: var(--accent, #d96a2e);
  user-select: none;
  animation: tour-marker-pulse 3.2s ease-in-out infinite;
}

.tour-marker-rune {
  font-size: 0.85rem;
  line-height: 1;
}

@keyframes tour-marker-pulse {
  0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--accent, #d96a2e) 0%, transparent); }
  50%      { box-shadow: 0 0 0 6px color-mix(in srgb, var(--accent, #d96a2e) 16%, transparent); }
}

.onboarding-fade-enter-active,
.onboarding-fade-leave-active { transition: opacity 240ms ease; }

.onboarding-fade-enter-from,
.onboarding-fade-leave-to { opacity: 0; }

@media (prefers-reduced-motion: reduce) {
  .tour-marker {
    animation: none;
  }
}
</style>

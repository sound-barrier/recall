import { ref, computed, onMounted } from 'vue'

import { usePersistedRef, parseBoolish, serializeBoolish } from './usePersistedRef'

// First-launch onboarding tour state + persisted completion flag.
//
// Shape mirrors the project's "persisted-preference family" pattern
// (useShowHidden / useDensityMode / etc. — see frontend/CLAUDE.md
// for the family description). usePersistedRef carries the
// localStorage hydration; this composable layers in the step-machine
// (current step, navigation, restart) on top.
//
// Gate semantics: the tour auto-opens on mount when
// `recall.onboardingCompleted` is missing or anything other than the
// literal "true". Skip / finish / Escape-dismiss all flip the flag,
// so a user who closes the tour via ANY affordance never sees it
// again unless they explicitly `restart()`.
//
// Step content lives in this file (not the component) so the
// composable can be unit-tested without mounting the SFC, and so
// adding/reordering steps is one diff. ViewId is the
// frontend-internal tab name; the component emits a `navigate`
// event when the active step's viewId changes so the actual Recall
// tab follows the briefing along.

export const ONBOARDING_COMPLETED_KEY = 'recall.onboardingCompleted'

export type OnboardingViewId = 'settings' | 'ingest' | 'matches' | 'unknown'

export interface OnboardingStep {
  // Two-digit string rendered as the HUD-style step glyph (the giant
  // Big-Noodle italic number). "00" = the welcome briefing; 01/02/03
  // mirror the Recall tab numbering (Settings/Parse/Matches).
  num: string
  // Monospace eyebrow text — "BRIEFING" / "OBJECTIVE N".
  tag: string
  // The h2 the screen-reader announces and the focus-trap labels via
  // aria-labelledby.
  heading: string
  // One-paragraph step body. Keep under ~45 words; the panel narrows
  // on small viewports.
  body: string
  // Optional view to switch the underlying app to when this step
  // becomes active. Welcome step intentionally omits it — the user
  // sees whatever they landed on before the tour appeared.
  viewId?: OnboardingViewId
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    num: '00',
    tag: 'BRIEFING',
    heading: 'Welcome to Recall',
    body: 'Recall watches your Overwatch screenshots and turns them into a searchable match history with stats. Three quick steps to get going.',
  },
  {
    num: '01',
    tag: 'OBJECTIVE 1',
    heading: 'Configure your folder',
    body: 'Open Settings (01) to point Recall at your Overwatch ScreenShots folder. Recall auto-detects the default location on first launch and you can change it anytime from Settings → Folders.',
    viewId: 'settings',
  },
  {
    num: '02',
    tag: 'OBJECTIVE 2',
    heading: 'Parse your screenshots',
    body: 'On the Parse tab (02), click Parse to ingest everything currently in your folder, or toggle Watch to auto-parse as you play.',
    viewId: 'ingest',
  },
  {
    num: '03',
    tag: 'OBJECTIVE 3',
    heading: 'Explore your matches',
    body: 'Your match history lives on Matches (03). Filter by hero, map, role or date; group by week; drill into per-match stats. You can re-run this tour anytime from Settings → Advanced.',
    viewId: 'matches',
  },
]

export interface UseOnboardingTourOptions {
  // Default true. Set false in tests that want to construct the
  // composable without immediately tripping its auto-open branch.
  autoOpenOnMount?: boolean
}

export function useOnboardingTour(opts: UseOnboardingTourOptions = {}) {
  const { value: completed, set: setCompleted } = usePersistedRef<boolean>({
    key: ONBOARDING_COMPLETED_KEY,
    defaultValue: false,
    parse: parseBoolish,
    serialize: serializeBoolish,
  })

  const open = ref(false)
  const stepIndex = ref(0)

  onMounted(() => {
    if (opts.autoOpenOnMount === false) return
    // usePersistedRef hydrates `completed` inside its own onMounted,
    // which Vue calls in registration order — ours runs after, so
    // the value is current by here.
    if (!completed.value) open.value = true
  })

  const totalSteps = ONBOARDING_STEPS.length
  const step       = computed(() => ONBOARDING_STEPS[stepIndex.value]!)
  const isFirstStep = computed(() => stepIndex.value === 0)
  const isLastStep  = computed(() => stepIndex.value === totalSteps - 1)
  // Human-readable 1-indexed step number for "01 / 04" rail counter.
  const stepNumber = computed(() => stepIndex.value + 1)

  function next() {
    if (isLastStep.value) {
      finish()
    } else {
      stepIndex.value += 1
    }
  }

  function prev() {
    if (!isFirstStep.value) stepIndex.value -= 1
  }

  function finish() {
    setCompleted(true)
    open.value = false
    stepIndex.value = 0
  }

  // Skip is functionally equivalent to finish — both persist
  // completion. Kept as a named alias so the call site reads
  // intentionally ("the user dismissed" vs "the user completed").
  function skip() {
    finish()
  }

  // Re-open the tour from step 0. Wired to a future Settings →
  // Advanced "Replay onboarding tour" button.
  function restart() {
    stepIndex.value = 0
    open.value = true
  }

  return {
    open,
    stepIndex,
    step,
    totalSteps,
    stepNumber,
    isFirstStep,
    isLastStep,
    completed: computed(() => completed.value),
    next,
    prev,
    finish,
    skip,
    restart,
  }
}

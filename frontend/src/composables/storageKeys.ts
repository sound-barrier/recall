// Shared localStorage keys for one-shot onboarding state.
//
// Lives in its own module so App.vue can read the key value without
// importing from `useOnboardingTour.ts` — that file pulls the full
// tour controller, demo records, and per-step Vue templates, all of
// which would land in the initial JS chunk via a transitive import.
// `App.lazy-views.test.ts` guards against the regression by asserting
// the tour stays dynamic-imported.
//
// Bundlers tree-shake leaf-module imports cleanly because this file
// has no side effects and no other exports.

export const ONBOARDING_COMPLETED_KEY = 'recall.onboardingCompleted'

// Step index parked before the tour seeds + switches into the sample
// "test" profile (which reloads the SPA). On the next mount the tour
// reopens at this step — now active in the test profile — then clears
// the key. Lives here (not in useOnboardingTour) so App.vue can read it
// synchronously without pulling the tour controller into the initial
// chunk.
export const ONBOARDING_RESUME_KEY = 'recall.onboarding.resumeStep'

// Per-contextual-callout "seen" state lives at this prefix + the
// callout id (the same id passed to useContextualCallout). The full
// onboarding tour's completed key (above) gates the WHOLE family:
// if the user dismissed onboarding, every contextual callout reads
// it as "seen" so a power user doesn't get re-tutorialed on each
// surface.
export const CONTEXTUAL_CALLOUT_KEY_PREFIX = 'recall.tour.'

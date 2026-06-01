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

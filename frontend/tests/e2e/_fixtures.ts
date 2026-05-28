/**
 * Shared Playwright test fixture.
 *
 * Wraps the base `test` so every spec gets a `page` with the
 * onboarding tour pre-dismissed. Without this every test that
 * starts in a fresh BrowserContext (the Playwright default) would
 * load the app with empty localStorage → OnboardingTour auto-opens
 * → the overlay hides every other UI element → 30s timeout.
 *
 * Usage: in your spec, swap
 *     import { test, expect } from '@playwright/test'
 * for
 *     import { test, expect } from './_fixtures'
 *
 * Exception: `onboarding-tour.spec.ts` itself imports `@playwright/
 * test` directly because its "appears on first visit" cases REQUIRE
 * empty localStorage. Don't migrate it.
 *
 * Underscore prefix on the filename keeps it out of Playwright's
 * default test-file glob (the runner picks up *.spec.ts but skips
 * everything else).
 */
import { test as base, expect } from '@playwright/test'

export const test = base.extend({
  page: async ({ page }, use) => {
    // addInitScript runs in every navigation context BEFORE any of
    // the page's own scripts — including App.vue's setup — so
    // useOnboardingTour's onMounted hook sees the flag already set
    // and doesn't auto-open the overlay.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.onboardingCompleted', 'true')
      } catch (_) {
        // Some sandboxed contexts forbid localStorage. The tour
        // composable's persistence layer also swallows the error,
        // so we mirror that defensiveness.
      }
    })
    await use(page)
  },
})

export { expect }

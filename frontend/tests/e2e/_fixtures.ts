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
import { test as base, expect, type Locator, type Page } from '@playwright/test'
import { CoverageReport } from 'monocart-coverage-reports'

import { COVERAGE_ENABLED, coverageOptions } from './coverage-options'

export const test = base.extend({
  page: async ({ page, browserName }, use) => {
    // addInitScript runs in every navigation context BEFORE any of
    // the page's own scripts — including App.vue's setup — so
    // useOnboardingTour's onMounted hook sees the flag already set
    // and doesn't auto-open the overlay.
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.onboardingCompleted', 'true')
        // First-run "Main account name" modal acks. Without this the
        // modal traps focus on every spec's first navigation and the
        // assertions race against a locked UI. The dedicated
        // first-run spec clears this flag in its own beforeEach.
        localStorage.setItem('recall.firstRunAccountNamed', 'true')
        // The what's-new strip is likewise pre-dismissed — it would
        // otherwise add two buttons to every view in every spec. Its own
        // spec (app/whats-new.spec.ts) opts back in.
        localStorage.setItem('recall.whatsNew.reviewsTab', 'seen')
      } catch (_) {
        // Some sandboxed contexts forbid localStorage. The tour
        // composable's persistence layer also swallows the error,
        // so we mirror that defensiveness.
      }
    })

    // V8 JS coverage is a Chromium/CDP feature — `page.coverage` no-ops in
    // WebKit — so collect only on chromium, and only when E2E_COVERAGE=1.
    // monocart caches each test's coverage on disk; globalTeardown reports
    // it. The normal e2e run (no env var) pays nothing. Coverage is
    // INFORMATIONAL: every call is wrapped so a coverage hiccup can never
    // turn a green test red.
    const collectCoverage = COVERAGE_ENABLED && browserName === 'chromium'
    if (collectCoverage) {
      await page.coverage.startJSCoverage({ resetOnNavigation: false }).catch(() => {})
    }

    await use(page)

    if (collectCoverage) {
      try {
        const entries = await page.coverage.stopJSCoverage()
        await new CoverageReport(coverageOptions).add(entries)
      } catch {
        // Coverage is best-effort — never fail the test over it.
      }
    }
  },
})

export { expect }

/**
 * A person's double-click on a control that swaps in place for its opposite.
 *
 * The first press lands, the replacement renders in the same spot, and the
 * second press arrives a beat later at the same coordinates — through the
 * mouse, not the locator, so Playwright's wait-until-enabled cannot rescue a
 * control that should have been held. `swapped` resolves once the
 * replacement is on screen.
 */
export async function clickTwiceInPlace(
  page: Page,
  target: Locator,
  swapped: () => Promise<void>,
  // Where on the control the press lands, as fractions of its box — for a
  // replacement that covers only part of the original's footprint.
  at: { x: number; y: number } = { x: 0.5, y: 0.5 },
): Promise<void> {
  // The mouse clicks viewport coordinates, so the control has to be on screen.
  await target.scrollIntoViewIfNeeded()
  const box = await target.boundingBox()
  if (!box) throw new Error('the control has no box to click')
  const x = box.x + box.width * at.x
  const y = box.y + box.height * at.y
  await page.mouse.click(x, y)
  await swapped()
  await page.mouse.click(x, y)
}

/** The Enter-Enter twin of clickTwiceInPlace: two presses on whatever holds focus. */
export async function pressEnterTwice(page: Page, swapped: () => Promise<void>): Promise<void> {
  await page.keyboard.press('Enter')
  await swapped()
  await page.keyboard.press('Enter')
}

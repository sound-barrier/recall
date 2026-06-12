/**
 * First-launch onboarding tour — appears on the first visit (no
 * persisted completion in localStorage), steps through the
 * configure / parse / explore loop, and stays dismissed on every
 * subsequent visit. Each Playwright test starts with a fresh
 * BrowserContext (so localStorage starts empty) which is exactly the
 * "first launch" condition the tour gates on.
 *
 * Sister files: smoke.spec.ts (page-loads contract), a11y.spec.ts
 * (axe-core audits — the tour overlay needs to clear the same WCAG
 * bar as the rest of the UI).
 */
import { test, expect, type Page } from '@playwright/test'

// Walk the tour forward by pressing Next until the callout heading
// matches `re` — heading-driven so the walk survives step-list edits.
async function walkToHeading(page: Page, re: RegExp, max = 30) {
  const heading = page.locator('.tour-callout-heading')
  for (let i = 0; i < max; i++) {
    if (re.test((await heading.textContent()) ?? '')) return
    await page.locator('button:has-text("Next")').click()
    await page.waitForTimeout(120)
  }
  throw new Error(`tour never reached a heading matching ${re}`)
}

test.describe('onboarding tour — first-launch behaviour', () => {
  // Pre-ack the first-run "Main account name" modal so the tour
  // overlay is the only thing the tests need to exercise. The tour
  // requires empty `recall.onboardingCompleted`; leaving the modal
  // ack flag empty too would stack two forced gates and the modal
  // would intercept every keystroke before the tour sees it.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try { localStorage.setItem('recall.firstRunAccountNamed', 'true') } catch (_) { /* ignore */ }
    })
  })

  test('appears on first visit (empty localStorage)', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()
    // Step 1/N indicator + the welcome heading.
    await expect(tour).toContainText(/welcome to recall/i)
  })

  test('Skip button dismisses and persists completion to localStorage', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()

    await tour.getByRole('button', { name: /skip/i }).click()
    await expect(tour).toBeHidden()

    // The localStorage flag must be set so subsequent loads don't
    // re-open the tour. Read via page.evaluate so the assertion
    // exercises the actual browser-side storage path.
    const completed = await page.evaluate(
      () => localStorage.getItem('recall.onboardingCompleted'),
    )
    expect(completed).toBe('true')
  })

  test('Explore step seeds + switches into "test", and the tour resumes on Done', async ({ page }) => {
    // The "Explore with real data" step seeds the sample profile and
    // SwitchProfile()s into it, which reloads the SPA. Mock both
    // endpoints so the test drives the reload-resume contract without
    // mutating the shared serveronly backend (a real seed would create
    // a persistent "test" profile + 500 matches that bleed into the
    // other specs sharing this server).
    let seedCalled = false
    await page.route('**/api/v1/profiles/test/seed', async (route) => {
      seedCalled = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ profile: 'test', matches: 500, already_seeded: false }),
      })
    })
    await page.route('**/api/v1/profiles/active', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'test', profiles: ['main', 'test'] }),
      })
    })

    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()
    await expect(tour).toContainText(/welcome to recall/i)

    // Step 2: tablist briefing.
    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/five tabs/i)

    // Step 3: Settings tab — the tour switches the underlying view.
    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/settings/i)
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    // Walk the rest of the way to the second-to-last "Explore with real
    // data" step (per-step copy assertions live in the spotlight spec).
    await walkToHeading(page, /explore with real data/i)

    // Pressing Next here seeds the "test" profile, parks the resume
    // step, switches profiles (mocked 200), and reloads the SPA. The
    // tour must reopen on the final Done step.
    await tour.getByRole('button', { name: /next/i }).click()
    await expect(page.locator('.tour-callout-heading'))
      .toContainText(/explore, then clean up/i, { timeout: 15000 })
    expect(seedCalled).toBe(true)

    // Final step's button is "Done" (the tour-finishing affordance),
    // not "Next". Finishing persists completion.
    await tour.getByRole('button', { name: /done/i }).click()
    await expect(tour).toBeHidden()
    const completed = await page.evaluate(
      () => localStorage.getItem('recall.onboardingCompleted'),
    )
    expect(completed).toBe('true')
  })

  test('does NOT re-appear after completion (reload)', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()
    await tour.getByRole('button', { name: /skip/i }).click()
    await expect(tour).toBeHidden()

    // Hard reload — localStorage persists across reload within the
    // same BrowserContext, so the gate should keep the overlay hidden.
    await page.reload()
    await expect(tour).toBeHidden()
  })

  test('Previous navigates to the previous step (and is disabled on step 1)', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')

    // Previous should be disabled on step 1 — there's no earlier step.
    const previous = tour.getByRole('button', { name: /previous/i })
    await expect(previous).toBeDisabled()

    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/five tabs/i)

    await expect(previous).toBeEnabled()
    await previous.click()
    await expect(tour).toContainText(/welcome to recall/i)
  })

  test('Escape key dismisses the tour (matches modal a11y convention)', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')
    await expect(tour).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(tour).toBeHidden()

    // Dismissal via Escape must persist completion too, otherwise the
    // tour would re-open on every reload for a user who Escapes out.
    const completed = await page.evaluate(
      () => localStorage.getItem('recall.onboardingCompleted'),
    )
    expect(completed).toBe('true')
  })
})

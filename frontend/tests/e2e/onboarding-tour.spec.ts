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
import { test, expect } from '@playwright/test'

test.describe('onboarding tour — first-launch behaviour', () => {
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

  test('Next walks every step in order; final step shows Done', async ({ page }) => {
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

    // Skip through the middle of the walkthrough — assertions on
    // every step's copy live in onboarding-tour-spotlight.spec.ts.
    // 14 steps total; we're on step 3 after the assertions above,
    // so 11 Next clicks lands us on step 14 (Done).
    for (let i = 0; i < 11; i++) {
      await tour.getByRole('button', { name: /next/i }).click()
      await page.waitForTimeout(150)
    }

    // Final step's button is "Done" (the tour-finishing affordance),
    // not "Next" — matches the copy-on-button convention used by
    // the rest of the app.
    await tour.getByRole('button', { name: /done/i }).click()
    await expect(tour).toBeHidden()
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

  test('Back navigates to the previous step (and is disabled on step 1)', async ({ page }) => {
    await page.goto('/')
    const tour = page.locator('[data-testid="onboarding-tour"]')

    // Back should be disabled on step 1 — there's no earlier step.
    const back = tour.getByRole('button', { name: /back/i })
    await expect(back).toBeDisabled()

    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/five tabs/i)

    await expect(back).toBeEnabled()
    await back.click()
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

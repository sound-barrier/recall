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

import { loanSlip, mockCoachSession, pinSessionResume } from '../_coach'

// Walk the tour forward by pressing Next until the callout heading
// matches `re` — heading-driven so the walk survives step-list edits.
async function walkToHeading(page: Page, re: RegExp, max = 30) {
  const heading = page.locator('.tour-callout-heading')
  for (let i = 0; i < max; i++) {
    if (re.test((await heading.textContent()) ?? '')) return
    await page.getByRole('button', { name: 'Next', exact: true }).click()
    await page.waitForTimeout(120)
  }
  throw new Error(`tour never reached a heading matching ${re}`)
}

test.describe('onboarding tour — first-launch behavior', () => {
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
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    // Step 1/N indicator + the welcome heading.
    await expect(tour).toContainText(/welcome to recall/i)
  })

  test('Skip button seeds the sample profile and resumes the tour on Done', async ({ page }) => {
    // Skip no longer just closes the tour — it fast-forwards to the seeded
    // exploration: seed the "test" profile, switch into it (which reloads the
    // SPA), and reopen on the final Done step so the user lands in real data
    // instead of an empty app. Mock both endpoints so the reload-resume
    // contract runs without mutating the shared serveronly backend.
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
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    await expect(tour).toContainText(/welcome to recall/i)

    // Skip straight from the first step — it seeds, switches, reloads, and the
    // tour reopens on Done (in the test profile), not just closing.
    await tour.getByRole('button', { name: /skip/i }).click()
    await expect(page.locator('.tour-callout-heading'))
      .toContainText(/explore, then clean up/i, { timeout: 15000 })
    expect(seedCalled).toBe(true)

    // Finishing from Done persists completion so the tour stays gone.
    await tour.getByRole('button', { name: /done/i }).click()
    await expect(tour).toBeHidden()
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
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    await expect(tour).toContainText(/welcome to recall/i)

    // Step 2: tablist briefing.
    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/seven tabs/i)

    // Step 3: Settings tab — the tour switches the underlying view.
    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/settings/i)
    await expect(page.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true')

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

  // Next on the sample step seeds and switches, and nothing stopped a second
  // press while the first was still seeding: both ran, twice each.
  test('a double press of Next on the sample step seeds once', async ({ page }) => {
    let seeds = 0
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/v1/profiles/test/seed', async (route) => {
      seeds++
      await held
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ profile: 'test', matches: 500, already_seeded: false }) })
    })
    await page.route('**/api/v1/profiles/active', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: 'test', profiles: ['main', 'test'] }) })
    })

    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    await walkToHeading(page, /explore with real data/i)
    const next = tour.getByRole('button', { name: /next/i })
    const box = await next.boundingBox()
    if (!box) throw new Error('Next has no box')
    await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2)

    await expect.poll(() => seeds).toBe(1)
    await page.waitForTimeout(300)
    expect(seeds).toBe(1)
    release()
    await expect(page.locator('.tour-callout-heading')).toContainText(/explore, then clean up/i, { timeout: 15000 })
  })

  // A coaching session refuses the sample profile, and the refusal came back
  // as a quiet success: Skip and the sample step's Next did nothing at all,
  // leaving Escape as the only way out of a tour that would not move.
  test('Skip during a coaching session finishes the tour and says why', async ({ page }) => {
    let seeds = 0
    await page.route('**/api/v1/profiles/test/seed', async (route) => {
      seeds++
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })
    await pinSessionResume(page)
    await mockCoachSession(page, { active: true })
    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    await expect(loanSlip(page)).toBeVisible()

    await tour.getByRole('button', { name: /skip/i }).click()
    await expect(tour).toBeHidden()
    await expect(page.getByText(/coaching session is open/i).first()).toBeVisible()
    expect(seeds).toBe(0)
  })

  test('does NOT re-appear after completion (reload)', async ({ page }) => {
    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeVisible()
    // Escape is the pure-dismiss path (Skip now seeds + reloads into the
    // sample profile); use it to close, then prove the persisted completion
    // flag keeps the tour hidden across a hard reload.
    await page.keyboard.press('Escape')
    await expect(tour).toBeHidden()

    // Hard reload — localStorage persists across reload within the
    // same BrowserContext, so the gate should keep the overlay hidden.
    await page.reload()
    await expect(tour).toBeHidden()
  })

  test('Previous navigates to the previous step (and is disabled on step 1)', async ({ page }) => {
    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')

    // Previous should be disabled on step 1 — there's no earlier step.
    const previous = tour.getByRole('button', { name: /previous/i })
    await expect(previous).toBeDisabled()

    await tour.getByRole('button', { name: /next/i }).click()
    await expect(tour).toContainText(/seven tabs/i)

    await expect(previous).toBeEnabled()
    await previous.click()
    await expect(tour).toContainText(/welcome to recall/i)
  })

  test('Escape key dismisses the tour (matches modal a11y convention)', async ({ page }) => {
    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')
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

  test('step pips jump directly to a step (skip-ahead)', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tour-callout')).toBeVisible()
    await expect(page.locator('.tour-callout-counter')).toContainText('01 /')

    // Jump straight to step 4 from the pip row — no linear stepping.
    await page.locator('.tour-pip').nth(3).click()
    await expect(page.locator('.tour-callout-counter')).toContainText('04 /')
    await expect(page.locator('.tour-pip').nth(3)).toHaveAttribute('aria-current', 'step')

    // And back to the start the same way.
    await page.locator('.tour-pip').first().click()
    await expect(page.locator('.tour-callout-counter')).toContainText('01 /')
  })
})

test.describe('onboarding tour — replay from Settings', () => {
  // The Done step promises "Replay this tour anytime from Settings →
  // Advanced" — this pins that the promise is real.
  test('Settings → Advanced replays the tour on demand', async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.firstRunAccountNamed', 'true')
        localStorage.setItem('recall.onboardingCompleted', 'true')
      } catch (_) { /* ignore */ }
    })
    await page.goto('/')
    const tour = page.getByTestId('onboarding-tour')
    await expect(tour).toBeHidden() // completed → no auto-open

    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('.advanced-summary').click()
    await page.locator('[data-replay-tour]').click()

    // The tour reopens from the top, over whatever view the user was on.
    await expect(tour).toBeVisible()
    await expect(tour).toContainText(/welcome to recall/i)
  })
})

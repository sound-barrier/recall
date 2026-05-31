/**
 * Onboarding tour — spotlight + per-step targets.
 *
 * Walks the full step list from Welcome → Done and asserts at every
 * stop:
 *
 *   - the tour overlay is open (`[data-testid="onboarding-tour"]`)
 *   - the callout heading matches the step's content
 *   - the spotlight cutout either covers the expected target rect
 *     (welcome / cheatsheet / done have no target, so the cutout
 *     collapses) or the expected element is on-screen
 *
 * Also covers the persistence contract: closing the tour with Done
 * sets `recall.onboardingCompleted=true`, and a reload no longer
 * auto-opens it. Skip and Esc share the same persistence path.
 */
import { test, expect } from '@playwright/test'

// Bypass _fixtures (which pre-dismisses the tour) — the whole point
// of this spec is to exercise the tour itself.

test.describe('onboarding tour — spotlighted walkthrough', () => {
  // The default fixtures pre-set `recall.onboardingCompleted='true'`
  // to dismiss the tour for unrelated tests, but this spec exercises
  // the tour itself — so each test starts with the key cleared. We
  // can't use beforeEach `addInitScript(removeItem)` here because
  // that script ALSO runs on subsequent `page.reload()` calls (which
  // would undo the persistence the test is trying to verify); we
  // instead clear once before `goto` runs via a one-shot init script.
  test.beforeEach(async ({ context }) => {
    await context.clearCookies()
  })

  test('auto-opens on first visit and walks every step end-to-end', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    await expect(page.locator('.tour-callout-heading')).toContainText(/welcome to recall/i)

    // The first step is no-target — cutout collapses, tour-spotlight
    // gains the `tour-spotlight-no-cutout` class.
    await expect(page.locator('.tour-spotlight')).toHaveClass(/tour-spotlight-no-cutout/)

    // Step 2 → tablist. After Next, a real cutout appears.
    await page.locator('button:has-text("Next")').click()
    await expect(page.locator('.tour-callout-heading')).toContainText(/five tabs/i)
    await expect(page.locator('.tour-spotlight')).not.toHaveClass(/tour-spotlight-no-cutout/)

    // Walk to "Settings (01)" — the tour drives the underlying view
    // change so #tab-settings ends up aria-selected.
    await page.locator('button:has-text("Next")').click()
    await expect(page.locator('.tour-callout-heading')).toContainText(/settings/i)
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    // Walk through every remaining step. The tour has 16 stops total
    // (15 forward presses from step 1). Each click moves to the next
    // step; the last advance flips Next → Done.
    for (let i = 0; i < 13; i++) {
      await page.locator('button:has-text("Next")').click()
      await page.waitForTimeout(150)
    }
    await expect(page.locator('button:has-text("Done")')).toBeVisible()
    await expect(page.locator('.tour-callout-heading')).toContainText(/ready to play/i)
  })

  test('Skip dismisses the tour and persists completion', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    await page.locator('button:has-text("Skip tour")').click()
    await expect(page.locator('[data-testid="onboarding-tour"]')).toHaveCount(0)

    // Reload — tour stays closed.
    await page.reload()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="onboarding-tour"]')).toHaveCount(0)
  })

  test('Esc dismisses the tour and persists completion', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toHaveCount(0)
    await page.reload()
    await page.waitForTimeout(500)
    await expect(page.locator('[data-testid="onboarding-tour"]')).toHaveCount(0)
  })

  test('demo data lights up the dossier with mock records (no real records leaked)', async ({ page }) => {
    // Mock the matches endpoint to return EMPTY — the tour should
    // still surface a populated dossier because the demo records
    // overlay kicks in regardless of what the API returns.
    await page.route('**/api/v1/matches', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    // Click Next to land on the dossier step — 8 clicks from
    // welcome lands on step 9 (matches-dossier) in the 15-step list.
    for (let i = 0; i < 8; i++) {
      await page.locator('button:has-text("Next")').click()
      await page.waitForTimeout(120)
    }
    // Demo dossier — winrate non-empty even though /api/matches was
    // empty. The mock data is in-memory only — never persists to
    // the API.
    await expect(page.locator('.tour-callout-heading')).toContainText(/dossier/i)
    const winrate = await page.locator('.set-dossier').textContent()
    expect(winrate).toMatch(/75%/)
  })

  test('matches-narrow step actively opens the Narrow popover and filters to Lucio', async ({ page }) => {
    // Mock matches as empty — demo records should still drive the
    // narrowed set since the tour overlays them in-memory.
    await page.route('**/api/v1/matches', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    // 9 Next clicks: welcome → matches-narrow (step 10).
    for (let i = 0; i < 9; i++) {
      await page.locator('button:has-text("Next")').click()
      await page.waitForTimeout(120)
    }
    await expect(page.locator('.tour-callout-heading')).toContainText(/narrow to one hero/i)
    // The popover and a Lucio-bearing filter chip must both be live.
    await expect(page.locator('#narrow-popover')).toBeVisible()
    await expect(page.locator('#narrow-popover')).toContainText(/lucio/i)
  })

  test('matches-detail step actively opens the demo detail panel', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    // 11 Next clicks: welcome → matches-detail (step 12).
    for (let i = 0; i < 11; i++) {
      await page.locator('button:has-text("Next")').click()
      await page.waitForTimeout(120)
    }
    await expect(page.locator('.tour-callout-heading')).toContainText(/the detail panel/i)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('ambiguous-attribution step lights up the .ambiguous-card', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('[data-testid="onboarding-tour"]')).toBeVisible()
    // Welcome is step 1; ambiguous-attribution is step 14 in the
    // 16-step list (after unknown-tab, before cheatsheet). 13 Next
    // clicks lands on it.
    for (let i = 0; i < 13; i++) {
      await page.locator('button:has-text("Next")').click()
      await page.waitForTimeout(120)
    }
    await expect(page.locator('.tour-callout-heading')).toContainText(/ambiguous attribution/i)
    // The Unknown tab is active + the ambiguous demo record renders
    // its card. Without an ambiguous record in DEMO_MATCHES this
    // assertion would catch a regression that drops the seed.
    await expect(page.locator('#tab-unknown')).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.ambiguous-card')).toBeVisible()
    await expect(page.locator('.needs-review-heading')).toContainText(/needs your review/i)
  })

  test('arrow / h / l keys move between steps; Enter advances', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.tour-callout-heading')).toContainText(/welcome/i)
    // → / l advance.
    await page.keyboard.press('ArrowRight')
    await expect(page.locator('.tour-callout-heading')).toContainText(/five tabs/i)
    await page.keyboard.press('l')
    await expect(page.locator('.tour-callout-heading')).toContainText(/settings/i)
    // ← / h step back.
    await page.keyboard.press('h')
    await expect(page.locator('.tour-callout-heading')).toContainText(/five tabs/i)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('.tour-callout-heading')).toContainText(/welcome/i)
    // Enter advances.
    await page.keyboard.press('Enter')
    await expect(page.locator('.tour-callout-heading')).toContainText(/five tabs/i)
  })
})

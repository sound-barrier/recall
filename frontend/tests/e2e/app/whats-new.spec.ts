/**
 * The what's-new strip — a one-time, dismissible pointer at a shipped
 * feature an existing user would otherwise never discover (the tour is
 * first-run only). One feature, one key, one sentence; dismissing it (or
 * taking it) is permanent for that feature.
 */
import { test, expect } from '../_fixtures'
import type { Page } from '@playwright/test'
import { seedProfiles, silenceParseEvents } from '../_theme-matrix'

const strip = (page: Page) => page.getByRole('region', { name: "What's new" })

test.describe("what's new", () => {
  test.beforeEach(async ({ page }) => {
    await silenceParseEvents(page)
    await seedProfiles(page)
    // Opt back in: the shared fixture pre-dismisses the strip for every
    // other spec; this one exists to see it. Init scripts run in order (so
    // this lands after the fixture's set) and on EVERY navigation — the
    // sessionStorage latch makes the removal a one-shot, or the reload
    // assertions would test the init script instead of the app.
    await page.addInitScript(() => {
      try {
        if (sessionStorage.getItem('wn-armed') === null) {
          sessionStorage.setItem('wn-armed', '1')
          localStorage.removeItem('recall.whatsNew.reviewsTab')
        }
      } catch (_) { /* mirrored */ }
    })
  })

  test('announces the Reviews tab once; Show me lands there and retires the strip', async ({ page }) => {
    await page.goto('/')
    await expect(strip(page)).toBeVisible()
    await expect(strip(page)).toContainText(/07 Reviews/)
    await strip(page).getByRole('button', { name: 'Show me' }).click()
    await expect(page.getByRole('tab', { name: /^Reviews/ })).toHaveAttribute('aria-selected', 'true')
    await expect(strip(page)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(strip(page)).toHaveCount(0)
  })

  test('dismissing it is permanent', async ({ page }) => {
    await page.goto('/')
    await strip(page).getByRole('button', { name: 'Not now' }).click()
    await expect(strip(page)).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('tablist')).toBeVisible()
    await expect(strip(page)).toHaveCount(0)
  })
})

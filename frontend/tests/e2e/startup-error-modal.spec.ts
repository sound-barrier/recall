/**
 * Startup-failure modal.
 *
 * On mount, App.vue polls GET /api/v1/system/startup-error and
 * surfaces the captured message in a blocking modal when non-empty.
 * Pre-fix, profile / DB-open failures produced a "flash and
 * disappear" window with no surface for the user to know why.
 *
 * The route is structurally reachable in server mode but normally
 * returns empty (RunServer log.Fatal's before mounting handlers if
 * Startup captured an error). Mocking the response is the only way
 * to drive the modal end-to-end.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('startup-error modal', () => {
  test('renders the captured message when the endpoint returns non-empty', async ({ page }) => {
    await page.route('**/api/v1/system/startup-error', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          message: 'startup: open SQLite /home/u/db/recall.db: read-only file system',
        }),
      })
    })

    await page.goto('/')

    const modal = page.getByTestId('startup-error-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toHaveAttribute('role', 'alertdialog')
    await expect(modal).toContainText('open SQLite /home/u/db/recall.db')
    // The body container goes inert + aria-hidden behind the modal.
    await expect(page.locator('.container')).toHaveAttribute('aria-hidden', 'true')
  })

  test('stays hidden when the endpoint returns an empty message', async ({ page }) => {
    await page.route('**/api/v1/system/startup-error', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ message: '' }),
      })
    })

    await page.goto('/')
    // Wait for one full tab nav cycle so the load() chain has settled
    // before asserting the absence of the modal.
    await page.locator('#tab-matches').waitFor({ state: 'visible' })

    await expect(page.getByTestId('startup-error-modal')).toHaveCount(0)
  })
})

/**
 * Settings → Advanced → "Re-parse all screenshots" — two-step arm
 * confirm + POST /api/v1/parses?scope=all wiring.
 *
 * Used to retroactively correct older records after a Recall
 * release tightens hero/map matching (e.g. the Miyazaki-misattri
 * bution fix). The destructive-tone confirm step prevents an
 * accidental multi-minute re-OCR.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('Settings — Re-parse all screenshots', () => {
  test('two-step confirm fires POST /api/v1/parses?scope=all', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([]),
      })
    })
    // App.vue's `onReParseAll` early-returns when tesseractReady=false,
    // so the e2e has to mock the status endpoint to a found-binary
    // response. The CI runner has no Tesseract installed.
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/opt/homebrew/bin/tesseract',
          found: true, version: '5.3.4', supported: true,
          error: '', platform: 'darwin',
        }),
      })
    })

    let reparseUrl: string | null = null
    await page.route('**/api/v1/parses*', async (route: Route) => {
      reparseUrl = route.request().url()
      await route.fulfill({ status: 202, body: '' })
    })

    await page.goto('/')
    // Switch to Settings tab.
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('#panel-settings')).toBeVisible()

    // Open the Advanced collapsible (native <details>). Force the
    // open attribute directly because the empty-hero picker now
    // pushes the Advanced section far down the page; a real .click()
    // works manually but Playwright's auto-scroll-into-view races
    // against the staggered card-in animations above.
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    const armBtn = page.locator('[data-reparse-all-arm]')
    await expect(armBtn).toBeVisible()

    // First click ARMS. Second click on the confirm button FIRES.
    await armBtn.click()
    const confirmBtn = page.locator('[data-reparse-all-confirm]')
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    await expect.poll(() => reparseUrl).not.toBeNull()
    expect(reparseUrl!).toContain('scope=all')
  })

  test('Cancel button disarms without firing the PUT', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([]),
      })
    })
    // App.vue's `onReParseAll` early-returns when tesseractReady=false,
    // so the e2e has to mock the status endpoint to a found-binary
    // response. The CI runner has no Tesseract installed.
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/opt/homebrew/bin/tesseract',
          found: true, version: '5.3.4', supported: true,
          error: '', platform: 'darwin',
        }),
      })
    })
    let fired = false
    await page.route('**/api/v1/parses*', async (route: Route) => {
      fired = true
      await route.fulfill({ status: 202, body: '' })
    })

    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    await page.locator('[data-reparse-all-arm]').click()
    // Click Cancel inside the confirm group.
    await page.locator('.clear-confirm-group .btn.ghost').first().click()
    // Wait briefly to be sure no PUT fires after disarm.
    await page.waitForTimeout(200)
    expect(fired).toBe(false)
    // The arm button is visible again.
    await expect(page.locator('[data-reparse-all-arm]')).toBeVisible()
  })
})

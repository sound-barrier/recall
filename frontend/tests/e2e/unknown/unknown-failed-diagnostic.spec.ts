/**
 * Diagnostic-bundle download from the failed-files section.
 *
 * The "Save diagnostic bundle" button lives in the section header. In
 * server mode it POSTs /api/v1/exports/diagnostic and blob-downloads
 * the zip (Wails mode routes through the native save dialog instead —
 * unit-covered). Disabled when nothing has failed, busy while building,
 * re-enabled after.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const failedRows = () => ([
  {
    filename: 'corrupt.png',
    error: 'decoding image: png: invalid format',
    attempts: 6,
    first_failed_at: '2026-07-01T20:00:00Z',
    last_failed_at: '2026-07-06T21:30:00Z',
  },
])

test.describe('Unknown tab — diagnostic bundle', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  })

  test('the header button POSTs the export and re-enables', async ({ page }) => {
    let posted = 0
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(failedRows()) })
    })
    await page.route('**/api/v1/exports/diagnostic', async (route: Route) => {
      posted++
      await route.fulfill({
        status: 200,
        contentType: 'application/zip',
        headers: { 'Content-Disposition': 'attachment; filename="recall-diagnostic-test.zip"' },
        body: Buffer.from('PK'),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const btn = page.locator('[data-diagnostic-bundle]')
    await expect(btn).toBeVisible()
    await expect(btn).toBeEnabled()

    const download = page.waitForEvent('download')
    await btn.click()
    await expect.poll(() => posted).toBe(1)
    expect((await download).suggestedFilename()).toBe('recall-diagnostic-test.zip')
    await expect(btn).toBeEnabled()
  })

  test('no failed files, no bundle button', async ({ page }) => {
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    await expect(page.getByRole('tabpanel', { name: /^Unknown/ })).toBeVisible()
    await expect(page.locator('[data-diagnostic-bundle]')).toHaveCount(0)
  })
})

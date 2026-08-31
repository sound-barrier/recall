/**
 * The Run Parse button vs parked files.
 *
 * A file that keeps failing OCR parks after the repeated-failure cap:
 * it leaves the button's count (the run will skip it) and is reported
 * separately, so the button stops promising work that will fail again —
 * the "Run Parse · 18 forever" loop. Three states:
 *
 *   count 3 / parked 2 → "Run Parse · 3" + a parked meta line
 *   count 0 / parked 2 → disabled + "All new screenshots parsed — 2 parked…"
 *   count 0 / parked 0 → the unchanged "nothing new" copy
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

async function bootWith(page: Page, pending: { count: number; parked: number }) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '/srv/recall' }) })
  })
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ path: '/usr/local/bin/tesseract', found: true, version: '5.5.0', supported: true, error: '', default: '/usr/local/bin/tesseract', platform: 'darwin' }),
    })
  })
  await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pending) })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Parse' }).click()
}

test.describe('Run Parse — parked files leave the count honestly', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('new files plus parked: the button counts only the new, the meta names the parked', async ({ page }) => {
    await bootWith(page, { count: 3, parked: 2 })

    const btn = page.getByTestId('run-parse-btn')
    await expect(btn).toHaveText(/Run Parse · 3/)
    await expect(btn).toBeEnabled()
    await expect(page.locator('#panel-ingest')).toContainText(/2 parked after repeated failures — retry from the Unknown tab\./)
  })

  test('only parked left: the button disables and the copy says why', async ({ page }) => {
    await bootWith(page, { count: 0, parked: 2 })

    await expect(page.getByTestId('run-parse-btn')).toBeDisabled()
    await expect(page.locator('#panel-ingest')).toContainText(/All new screenshots parsed — 2 parked after repeated failures\./)
  })

  test('nothing new, nothing parked: the unchanged all-parsed copy', async ({ page }) => {
    await bootWith(page, { count: 0, parked: 0 })

    await expect(page.getByTestId('run-parse-btn')).toBeDisabled()
    await expect(page.locator('#panel-ingest')).toContainText(/All screenshots already parsed — nothing new in the folder\./)
    await expect(page.locator('#panel-ingest')).not.toContainText(/parked/)
  })
})

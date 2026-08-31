/**
 * The Failed section's parked rows.
 *
 * A row the repeated-failure cap parked shows its state and a Retry —
 * DELETE /api/v1/screenshots/{filename}/failure resets the attempt
 * count so the file re-enters the pending count on the spot. A row
 * still below the cap shows no Retry: it is already retried on the next
 * run, so the button would be a lie (and on a stored degraded row it
 * would re-read nothing at all).
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const failedRow = (filename: string, parked: boolean, attempts: number) => ({
  filename,
  error: 'decoding image: png: invalid format',
  attempts,
  parked,
  first_failed_at: '2026-07-01T20:15:00Z',
  last_failed_at: '2026-07-06T21:30:00Z',
})

test.describe('Unknown tab — parked failures retry', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('a parked row shows the state and Retry restores it to pending', async ({ page }) => {
    let retried = false
    let retryHits = 0
    let pendingFetches = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      const rows = retried
        ? [failedRow('young.png', false, 1)]
        : [failedRow('stuck.png', true, 3), failedRow('young.png', false, 1)]
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) })
    })
    await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
      pendingFetches++
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(retried ? { count: 1, parked: 0 } : { count: 0, parked: 1 }),
      })
    })
    await page.route('**/api/v1/screenshots/stuck.png/failure', async (route: Route) => {
      retryHits++
      retried = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const section = page.locator('#section-failed')
    await expect(section).toContainText(/Parked — won't retry automatically/)
    // Only the parked row carries Retry.
    await expect(section.getByRole('button', { name: 'Retry stuck.png' })).toBeVisible()
    await expect(section.getByRole('button', { name: 'Retry young.png' })).toHaveCount(0)

    const fetchesBeforeRetry = pendingFetches
    await section.getByRole('button', { name: 'Retry stuck.png' }).click()
    await expect.poll(() => retryHits).toBe(1)

    // The ledger and the pending count both refetch — the file moved
    // from parked back into the button's count.
    await expect(section).not.toContainText('stuck.png')
    await expect.poll(() => pendingFetches).toBeGreaterThan(fetchesBeforeRetry)
  })
})

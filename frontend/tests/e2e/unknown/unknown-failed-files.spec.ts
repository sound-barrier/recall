/**
 * Unknown tab — "Failed to read" triage section.
 *
 * Screenshots whose OCR attempt failed have no MatchRecord at all, so
 * they ride a dedicated ledger (GET /api/v1/screenshots/failed) instead
 * of the records array. The section lists each failure with its error,
 * attempt count, and the same two-click Dismiss suppression the
 * unmatched cards use (PUT /api/v1/screenshots/{file}/ignore). Failed
 * files retry on the next few parse runs, then park — the copy says so.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const failedRows = () => ([
  {
    filename: 'corrupt.png',
    error: 'decoding image: png: invalid format',
    attempts: 6,
    parked: false,
    first_failed_at: '2026-07-01T20:00:00Z',
    last_failed_at: '2026-07-06T21:30:00Z',
  },
  {
    filename: 'menu-shot.png',
    error: 'could not locate the highlighted (lighter blue) row in the teams',
    attempts: 3,
    parked: false,
    first_failed_at: '2026-07-02T20:00:00Z',
    last_failed_at: '2026-07-06T21:31:00Z',
  },
])

test.describe('Unknown tab — failed files', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  })

  test('lists each failure with error and attempts; Dismiss suppresses it', async ({ page }) => {
    let ignoreHits = 0
    let ignored = false
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      const body = ignored ? failedRows().slice(1) : failedRows()
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    })
    await page.route('**/api/v1/screenshots/corrupt.png/ignore', async (route: Route) => {
      ignoreHits++
      ignored = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    const section = page.locator('#section-failed')
    await expect(section).toBeVisible()
    await expect(section).toContainText(/Failed to read \(2\)/i)
    await expect(section).toContainText('corrupt.png')
    await expect(section).toContainText('decoding image: png: invalid format')
    await expect(section).toContainText(/6 attempts/i)
    // The retry semantic is stated so the standing "N remaining" count
    // makes sense.
    await expect(section).toContainText(/retried on\s+the next few parse runs/i)

    const btn = page.locator('[data-failed-ignore="corrupt.png"]')
    await btn.click()
    await expect(btn).toHaveText(/Confirm dismiss\?/i)
    expect(ignoreHits).toBe(0)
    await btn.click()
    await expect.poll(() => ignoreHits).toBe(1)

    // The list refetches; the suppressed row is gone, the other stays.
    await expect(section).not.toContainText('corrupt.png')
    await expect(section).toContainText('menu-shot.png')
  })

  test('section is absent when nothing has failed', async ({ page }) => {
    await page.route('**/api/v1/screenshots/failed', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: /^Unknown/ }).click()

    await expect(page.getByRole('tabpanel', { name: /^Unknown/ })).toBeVisible()
    await expect(page.locator('#section-failed')).toHaveCount(0)
  })
})

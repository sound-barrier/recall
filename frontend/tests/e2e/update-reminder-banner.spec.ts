/**
 * "Haven't checked in 90 days" reminder banner.
 *
 * Lives between the masthead and main content. Gates on the
 * server-side `last_checked_at` field of /api/v1/system/update and a
 * localStorage-persisted dismissedAt timestamp (per-cycle dismissal).
 * "Check now" inside the banner opens the update-check modal.
 *
 * Spec mocks /system/update with route handlers — the actual server's
 * timestamp is irrelevant.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const DAYS = 24 * 60 * 60 * 1000

async function mockUpdate(page: import('@playwright/test').Page, lastCheckedAt: string | null) {
  await page.route('**/api/v1/system/update', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        checked: true, dev_build: false, available: false,
        latest: '0.3.0', url: 'https://example.test/release/0.3.0',
        ...(lastCheckedAt ? { last_checked_at: lastCheckedAt } : {}),
        data: { applied_tag: '0.3.0', has_update: false },
      }),
    })
  })
}

async function mockVersion(page: import('@playwright/test').Page, v: string) {
  await page.route('**/api/v1/system/version', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ version: v }),
    })
  })
}

test.describe('update reminder banner', () => {
  test('shows when last_checked_at has never been set', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, null)
    await page.goto('/')

    // The update-check needs to run at least once for updateInfo to
    // be loaded. The reminder banner reads from that response.
    await page.locator('[data-update-check-trigger]').click()
    await page.locator('.update-check-modal-close').click()

    await expect(page.locator('.update-reminder-banner')).toBeVisible()
  })

  test('hides when last_checked_at is within the threshold (30 days)', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    const recent = new Date(Date.now() - 30 * DAYS).toISOString()
    await mockUpdate(page, recent)
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('.update-check-modal-close').click()

    await expect(page.locator('.update-reminder-banner')).toHaveCount(0)
  })

  test('shows when last_checked_at is older than 90 days', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    const stale = new Date(Date.now() - 120 * DAYS).toISOString()
    await mockUpdate(page, stale)
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('.update-check-modal-close').click()

    await expect(page.locator('.update-reminder-banner')).toBeVisible()
    await expect(page.getByText(/Last checked 120 days ago/)).toBeVisible()
  })

  test('the dismiss button hides the banner for this cycle', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    const stale = new Date(Date.now() - 120 * DAYS).toISOString()
    await mockUpdate(page, stale)
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('.update-check-modal-close').click()
    await expect(page.locator('.update-reminder-banner')).toBeVisible()

    await page.locator('[data-update-reminder-dismiss]').click()
    await expect(page.locator('.update-reminder-banner')).toHaveCount(0)
  })

  test('"Check now" inside the banner opens the modal', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    const stale = new Date(Date.now() - 120 * DAYS).toISOString()
    await mockUpdate(page, stale)
    await page.goto('/')

    // Open + close once so the banner has an updateInfo to gate on.
    await page.locator('[data-update-check-trigger]').click()
    await page.locator('.update-check-modal-close').click()

    await page.locator('[data-update-reminder-check]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
  })
})

import { expect, type Page } from '@playwright/test'

import { test } from './_fixtures'

// Settings → Advanced → Database health: integrity_check + optimize +
// compact surfaced in-app (the audit's "no live-DB health surface"
// gap, promoted from the FEATURES.md triage list). The backend is
// mocked per the harness convention; the Go handler has its own
// tests — this spec proves the full transport chain and the UI state
// machine (idle → checking → report; busy during maintenance).

const HEALTH = {
  integrity: 'ok',
  size_bytes: 4_567_040,
  wal_bytes: 32_768,
  freelist_pages: 12,
  page_count: 1115,
  checked_at: '2026-07-03T10:00:00Z',
}

const AFTER_VACUUM = {
  ...HEALTH,
  size_bytes: 4_100_096,
  freelist_pages: 0,
  checked_at: '2026-07-03T10:01:00Z',
}

async function openAdvanced(page: Page) {
  await page.goto('/')
  await page.locator('#tab-settings').click()
  await page.locator('.advanced-summary').click()
}

test.describe('database health panel', () => {
  test('check health reports integrity and size', async ({ page }) => {
    await page.route('**/api/v1/database/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }))

    await openAdvanced(page)
    const panel = page.locator('[data-db-health]')
    await expect(panel).toBeVisible()

    await panel.getByRole('button', { name: /check health/i }).click()
    await expect(panel).toContainText(/integrity.*ok/i)
    await expect(panel).toContainText(/4\.4\s*MB/i)
  })

  test('a failed integrity check is surfaced, not hidden', async ({ page }) => {
    await page.route('**/api/v1/database/health', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ ...HEALTH, integrity: 'row 17 missing from index idx_x' }),
      }))

    await openAdvanced(page)
    const panel = page.locator('[data-db-health]')
    await panel.getByRole('button', { name: /check health/i }).click()
    await expect(panel).toContainText(/row 17 missing/i)
  })

  test('compact runs maintenance and refreshes the report', async ({ page }) => {
    await page.route('**/api/v1/database/health', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(HEALTH) }))
    await page.route('**/api/v1/database/maintenance', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(AFTER_VACUUM) }))

    await openAdvanced(page)
    const panel = page.locator('[data-db-health]')
    await panel.getByRole('button', { name: /check health/i }).click()
    await expect(panel).toContainText(/4\.4\s*MB/i)

    await panel.getByRole('button', { name: /compact/i }).click()
    await expect(panel).toContainText(/3\.9\s*MB/i)
  })
})

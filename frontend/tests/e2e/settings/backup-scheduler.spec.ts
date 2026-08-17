/**
 * Auto-backup scheduler E2E.
 *
 * Settings → Backup & Restore gains an "Automatic backups" row: an
 * interval select (Off / Daily / Weekly / Monthly), a "Last automatic
 * backup" line, and a stale warning when the newest snapshot is older
 * than the interval. GET /api/v1/settings/auto-backup seeds the row;
 * changing the select PUTs {interval_days} and re-renders from the
 * echoed status.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

type Status = { interval_days: number, last_backup_at?: string, stale: boolean }

async function mockAutoBackup(page: import('@playwright/test').Page, initial: Status) {
  let status = initial
  const puts: number[] = []
  await page.route('**/api/v1/settings/auto-backup', async (route: Route) => {
    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}') as { interval_days: number }
      puts.push(body.interval_days)
      status = { ...status, interval_days: body.interval_days }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status) })
  })
  return puts
}

test.describe('automatic backup scheduler — Settings row', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  })

  test('renders interval + last-backup line and PUTs on change', async ({ page }) => {
    const puts = await mockAutoBackup(page, {
      interval_days: 7,
      last_backup_at: '2026-07-05T10:00:00Z',
      stale: false,
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()

    await expect(page.locator('[data-auto-backup-interval="7"]')).toHaveClass(/active/)
    await expect(page.locator('[data-auto-backup-last]')).toContainText(/last automatic backup/i)
    await expect(page.locator('.auto-backup-stale')).toHaveCount(0)

    await page.locator('[data-auto-backup-interval="1"]').click()
    await expect.poll(() => puts.length).toBe(1)
    expect(puts[0]).toBe(1)
    await expect(page.locator('[data-auto-backup-interval="1"]')).toHaveClass(/active/)
  })

  test('stale snapshot shows the warning; none-yet copy when empty', async ({ page }) => {
    await mockAutoBackup(page, { interval_days: 7, last_backup_at: '', stale: true })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()

    await expect(page.locator('[data-auto-backup-last]')).toContainText(/no automatic backup yet/i)
    await expect(page.locator('.auto-backup-stale')).toBeVisible()
  })

  test('Off state renders without a stale warning', async ({ page }) => {
    await mockAutoBackup(page, { interval_days: -1, last_backup_at: '', stale: false })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()

    await expect(page.locator('[data-auto-backup-interval="-1"]')).toHaveClass(/active/)
    await expect(page.locator('.auto-backup-stale')).toHaveCount(0)
  })
})

/**
 * In-app self-update — the About dialog's "Install update" affordance.
 *
 * The serveronly e2e harness can't run a real updater or emit the
 * wails:updater:* events, so this spec pins the UI gate + transport:
 *   - "Install update" shows only when can_self_update is true;
 *   - clicking it POSTs /api/v1/system/self-update and enters a busy state;
 *   - a 409 (self-update unavailable) surfaces an error without closing;
 *   - "Open release page" is the always-present fallback.
 * The full event-driven state machine (download → ready → restart) is
 * pinned at the Vitest layer (stores/app.test.ts) where wails:updater:*
 * events can be injected.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { openAbout } from '../_menu'

async function mockVersion(page: import('@playwright/test').Page, v: string) {
  await page.route('**/api/v1/system/version', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: v }) }))
}

async function mockUpdate(page: import('@playwright/test').Page, canSelfUpdate: boolean) {
  await page.route('**/api/v1/system/update', (route: Route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        checked: true, dev_build: false, available: true, latest: '9.9.9',
        url: 'https://example.test/release/9.9.9',
        game_data: { commit_sha: '', applied_commit: '', has_update: false },
        can_self_update: canSelfUpdate,
      }),
    }))
}

test.describe('in-app self-update', () => {
  test('shows Install update and posts the start request when self-update is possible', async ({ page }) => {
    await mockVersion(page, '1.0.0')
    await mockUpdate(page, true)

    let started = false
    await page.route('**/api/v1/system/self-update', (route: Route) => {
      started = true
      return route.fulfill({ status: 202, contentType: 'application/json', body: '' })
    })

    await page.goto('/')
    await openAbout(page)
    const section = page.locator('[data-update-check-available]')
    await expect(section).toBeVisible()

    const install = page.locator('[data-self-update-install]')
    await expect(install).toBeVisible()
    await install.click()

    await expect.poll(() => started).toBe(true)
    // Busy state: the install control is replaced by a progress indicator.
    await expect(page.locator('[data-self-update-progress]')).toBeVisible()
    // Fallback link stays available throughout.
    await expect(page.locator('[data-update-check-open-release]')).toBeVisible()
  })

  test('hides Install update and shows only the release-page fallback when self-update is impossible', async ({ page }) => {
    await mockVersion(page, '1.0.0')
    await mockUpdate(page, false)

    await page.goto('/')
    await openAbout(page)
    await expect(page.locator('[data-update-check-available]')).toBeVisible()
    await expect(page.locator('[data-self-update-install]')).toHaveCount(0)
    await expect(page.locator('[data-update-check-open-release]')).toBeVisible()
  })

  test('surfaces an error and keeps the dialog open when the start request 409s', async ({ page }) => {
    await mockVersion(page, '1.0.0')
    await mockUpdate(page, true)
    await page.route('**/api/v1/system/self-update', (route: Route) =>
      route.fulfill({
        status: 409, contentType: 'application/problem+json',
        body: JSON.stringify({ type: 'https://example/problems/self-update-unavailable', title: 'Conflict', status: 409, detail: 'self-update unavailable on this install' }),
      }))

    await page.goto('/')
    await openAbout(page)
    await page.locator('[data-self-update-install]').click()

    await expect(page.locator('[data-self-update-error]')).toBeVisible()
    // Dialog stays open; the fallback remains.
    await expect(page.locator('[data-about-modal]')).toBeVisible()
    await expect(page.locator('[data-update-check-open-release]')).toBeVisible()
  })
})

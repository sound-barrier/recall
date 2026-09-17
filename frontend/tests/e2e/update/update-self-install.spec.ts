/**
 * In-app self-update — the About dialog's "Install update" affordance.
 *
 * The serveronly e2e harness can't run a real updater, so the server never
 * emits wails:updater:* events. This spec pins the UI gate + transport:
 *   - "Install update" shows only when can_self_update is true;
 *   - clicking it POSTs /api/v1/system/self-update and enters a busy state;
 *   - a 409 (self-update unavailable) surfaces an error without closing;
 *   - "Open release page" is the always-present fallback;
 *   - a refused release, delivered page-side through the SSE mock the way
 *     the Go updater's wails:updater:error event arrives, gets the dialog's
 *     own explanation rather than the raw error text, and only while the
 *     update check still names that release as the latest.
 * The full event-driven state machine (download → ready → restart) is
 * pinned at the Vitest layer (stores/app.test.ts).
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'
import { openAbout } from '../_menu'
import { emitSSEEvent, installSSEMock } from '../_session-sse'

async function mockVersion(page: Page, v: string) {
  await page.route('**/api/v1/system/version', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: v }) }))
}

async function mockUpdate(page: Page, canSelfUpdate: boolean, latest = '9.9.9') {
  await page.route('**/api/v1/system/update', (route: Route) =>
    route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        checked: true, dev_build: false, available: true, latest,
        url: `https://example.test/release/${latest}`,
        game_data: { commit_sha: '', applied_commit: '', has_update: false },
        can_self_update: canSelfUpdate,
      }),
    }))
}

// Starts an install from the About dialog and answers it with a refusal. The
// Go side wraps every refusal in errUpdateRefused, and Wails flattens it into
// the event's message behind its own prefixes (pkg/cmd/selfupdate.go).
async function refuseTheUpdate(page: Page): Promise<void> {
  await installSSEMock(page)
  await mockVersion(page, '1.0.0')
  await mockUpdate(page, true)
  await page.route('**/api/v1/system/self-update', (route: Route) =>
    route.fulfill({ status: 202, contentType: 'application/json', body: '' }))

  await page.goto('/')
  await openAbout(page)
  await page.locator('[data-self-update-install]').click()
  await expect(page.locator('[data-self-update-progress]')).toBeVisible()

  await emitSSEEvent(page, 'wails:updater:error', {
    stage: 'check',
    message: 'updater: all providers failed: github: update refused: release 9.9.9 is not covered by its SHA256SUMS',
  })
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

  test('explains a refused update in place of the raw error, without sending anyone to install it by hand', async ({ page }) => {
    await refuseTheUpdate(page)

    const about = page.getByRole('dialog', { name: 'About Recall' })
    const refusal = about.getByRole('alert')
    await expect(refusal).toContainText("couldn't verify this update")
    await expect(refusal).toContainText('Nothing on your computer was changed')
    await expect(refusal).toContainText("Don't install this release by hand")
    await expect(refusal).not.toContainText('SHA256SUMS')
    await expect(about.getByRole('button', { name: 'Open release page' })).toBeEnabled()
  })

  // Recall lives in the tray, so a newer release can ship while the refusal
  // of an older one is still on record.
  test('drops the refusal once the update check names a newer release', async ({ page }) => {
    await refuseTheUpdate(page)
    const about = page.getByRole('dialog', { name: 'About Recall' })
    await expect(about.getByRole('alert')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(about).toBeHidden()
    await mockUpdate(page, true, '9.9.10')
    await openAbout(page)

    await expect(about.getByText('v9.9.10')).toBeVisible()
    await expect(about.getByRole('alert')).toHaveCount(0)
    await expect(about.getByRole('button', { name: 'Install update' })).toBeEnabled()
  })
})

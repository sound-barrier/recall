/**
 * Window close-behavior toggle (Settings → Window, section 07).
 *
 * Desktop-only setting: closing the window hides to the tray (default) or quits
 * Recall. The section is hidden on macOS (which always keeps the app in the menu
 * bar), so the toggle test forces a Windows UA — which also keeps the app on the
 * server-mode fetch transport (no 'wails' marker) so the full chain is exercised:
 * api.ts ↔ PUT /api/v1/settings/close-behavior ↔ Go handler.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Windows UA → isMacOS() false (the Window section renders) AND no 'wails' marker
// (server-mode fetch transport, not the Wails IPC bridge that needs a runtime).
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

test.describe('window close-behavior toggle', () => {
  test.use({ userAgent: WINDOWS_UA })

  test('toggling persists exit_on_close via PUT and reflects the saved state', async ({ page }) => {
    let putBody: unknown = null
    await page.route('**/api/v1/settings/close-behavior', async (route: Route) => {
      const req = route.request()
      if (req.method() === 'PUT') {
        putBody = req.postDataJSON()
        await route.fulfill({ status: 204, body: '' })
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ exit_on_close: false }),
        })
      }
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    const toggle = page.locator('[data-testid="exit-on-close-toggle"]')
    await expect(toggle).toBeVisible()
    await expect(toggle).not.toBeChecked()

    await toggle.click()

    // The PUT carried the new state, and the switch commits to it on success.
    await expect.poll(() => putBody).toEqual({ exit_on_close: true })
    await expect(toggle).toBeChecked()
  })
})

test.describe('window close-behavior on macOS', () => {
  test.use({ userAgent: MAC_UA })

  test('the Window section is hidden (macOS stays in the menu bar)', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-settings').click()
    await expect(page.locator('#sec-window')).toHaveCount(0)
  })
})

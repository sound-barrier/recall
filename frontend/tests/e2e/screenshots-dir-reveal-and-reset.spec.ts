/**
 * Screenshots-folder Reveal + Reset + Detect-disabled steady state.
 *
 * Three changes covered:
 *
 *   1. Reveal — clicking the Reveal button after picking a folder used
 *      to fire BrowserOpenURL('file://...') in Wails mode, which
 *      Wails v2.12's ValidateAndSanitizeURL rejects with "scheme not
 *      allowed". Server mode would have rendered an empty new tab
 *      (the WebKit/Chromium URL bar happily accepts file:// but the
 *      sandboxed page can't navigate to it). The replacement is a
 *      dedicated backend action: POST /api/v1/system/screenshots-
 *      folder-reveal. The backend shells out to `open` / `explorer`
 *      / `xdg-open` against the configured screenshots dir; the
 *      frontend just fires-and-forgets.
 *
 *   2. Reset — new affordance in the steady-state row. DELETE
 *      /api/v1/settings/screenshots-folder clears the persisted path,
 *      the UI re-renders the empty-hero, and the user can now click
 *      Detect (re-enabled because no folder is set).
 *
 *   3. Detect-disabled-when-set — in the steady-state row, Detect is
 *      always shown as disabled. The intent: "if a folder is picked,
 *      Detect should not be selectable" (paraphrasing the user
 *      request). The user must Reset first to un-gate Detect.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const PERSISTED_PATH = '/Users/test/Documents/Overwatch/ScreenShots/Overwatch'

// Stateful settings route: the persisted variable IS the on-disk
// settings.json value, mutated by PUT/DELETE, read by GET.
function installSettingsRoute(page: import('@playwright/test').Page, initial: string) {
  let persisted = initial
  page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ path: persisted }),
      })
      return
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { path?: string }
      if (body?.path) persisted = body.path
      await route.fulfill({ status: 204 })
      return
    }
    if (method === 'DELETE') {
      persisted = ''
      await route.fulfill({ status: 204 })
      return
    }
    await route.continue()
  })
  return { get persisted() { return persisted } }
}

test.describe('settings — Reveal button calls the new backend action', () => {
  test('clicking Reveal fires POST /api/v1/system/screenshots-folder-reveal', async ({ page }) => {
    installSettingsRoute(page, PERSISTED_PATH)

    let revealCalls = 0
    await page.route('**/api/v1/system/screenshots-folder-reveal', async (route: Route) => {
      revealCalls++
      await route.fulfill({ status: 204 })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // The steady-state row should render with the persisted path.
    await expect(page.locator('.setting-value.mono')).toContainText(PERSISTED_PATH)

    // Click Reveal. In server-mode (where this test runs), the
    // Reveal button is hidden (canOpenFolder = IS_WAILS). For this
    // spec we ALSO want the button visible in server mode — the
    // backend can open the file manager on its own host, so this
    // is the right behavior whether the user runs Wails or server.
    const revealBtn = page.locator('button:has-text("Reveal")')
    await expect(revealBtn).toBeVisible()
    await revealBtn.click()

    // The action endpoint should have been called exactly once.
    await expect.poll(() => revealCalls).toBe(1)
  })
})

test.describe('settings — Reset clears the persisted path', () => {
  test('clicking Reset hits DELETE and re-renders the empty hero', async ({ page }) => {
    const settings = installSettingsRoute(page, PERSISTED_PATH)

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Steady-state row visible, persisted path shown.
    await expect(page.locator('.setting-value.mono')).toContainText(PERSISTED_PATH)
    await expect(page.locator('.empty-hero')).toHaveCount(0)

    // Click Reset. The Engine row ALSO has a Reset button now, so
    // scope to the directories section to avoid strict-mode failures.
    const resetBtn = page.locator('#sec-directories button:has-text("Reset")')
    await expect(resetBtn).toBeVisible()
    await resetBtn.click()

    // DELETE round-trip cleared persisted storage.
    await expect.poll(() => settings.persisted).toBe('')

    // UI follows: empty-hero appears, steady-state row vanishes.
    await expect(page.locator('.empty-hero')).toBeVisible()
    await expect(page.locator('.setting-value.mono')).toHaveCount(0)
  })
})

test.describe('settings — Detect is disabled in the steady-state row', () => {
  test('Detect is greyed out when a folder is set; re-enables after Reset', async ({ page }) => {
    installSettingsRoute(page, PERSISTED_PATH)

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // In the steady-state row, Detect renders but is disabled.
    // Scope to the directories section because Engine ALSO has a
    // `.detect-btn` now (the Tesseract Detect button shipped in this
    // PR).
    const detectInRow = page.locator('#sec-directories .detect-btn')
    await expect(detectInRow).toBeVisible()
    await expect(detectInRow).toBeDisabled()

    // Reset → empty-hero re-renders with the four-source picker
    // (the old "Auto-Detect Folder" / "Choose Manually" CTA pair
    // was replaced by the picker grid + custom-pick tile in the
    // ScreenshotSourcePicker PR).
    await page.locator('#sec-directories button:has-text("Reset")').click()

    await expect(page.locator('.empty-hero .src-picker')).toBeVisible()
    await expect(page.locator('.empty-hero [data-src-pick-custom]')).toBeVisible()
  })
})

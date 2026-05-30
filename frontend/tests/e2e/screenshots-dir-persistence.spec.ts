/**
 * Screenshots-folder persistence across sessions.
 *
 * User-reported bug: "each time I start up my app I have to change my
 * screenshot folder. it doesn't seem to persist across sessions."
 *
 * Repro shape:
 *   1. Boot with no folder configured (GetScreenshotsDir = "").
 *   2. Pick a folder (PickScreenshotsDir → returns the new path).
 *   3. UI shows the new path.
 *   4. RELOAD the page (simulates the user restarting the app).
 *   5. Boot reads the persisted folder — the path is still there.
 *
 * The persistence contract has two halves:
 *   - WRITE: pickDir() must trigger a backend persistence call so
 *     restart sees the value.
 *   - READ: on reload, GetScreenshotsDir must return the persisted
 *     value, and the UI must render it.
 *
 * Both halves get exercised here. The route handler is stateful —
 * it tracks the "persisted" path between requests so the reload
 * actually round-trips through the GET/PUT contract.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('settings — screenshots folder persists across reloads', () => {
  test('picking a folder then reloading keeps the path on screen', async ({ page }) => {
    // Stateful mock: this variable IS the "persisted" path. Survives
    // across page.reload() because the route handler is registered
    // at the context level, not the page level.
    let persisted = ''

    // Path the user "picks" from the picker. Includes a space to
    // exercise the path-with-spaces case (common on macOS / Windows).
    const pickedPath = '/Users/test/Library/Application Support/Recall/screenshots'

    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
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
      await route.continue()
    })

    // Mock the picker so we don't actually pop a window.prompt during
    // the test. PickScreenshotsDir in server mode normally:
    //   GET current → prompt → PUT new → return new
    // We intercept the PUT above and have the UI show the result via
    // GET on reload. To skip the window.prompt, we override it via
    // addInitScript before any page script runs.
    await page.addInitScript((p) => {
      window.prompt = () => p
    }, pickedPath)

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Confirm the steady-state row is HIDDEN initially (no folder).
    await expect(page.locator('.setting-value.mono')).toHaveCount(0)

    // Click the Change… button (or Choose Manually in the empty-hero
    // depending on state). Both emit pick-screenshots-dir.
    const pickButton = page.locator('button:has-text("Choose Manually"), button:has-text("Change")').first()
    await pickButton.click()

    // After picking, the row should show the path.
    await expect(page.locator('.setting-value.mono')).toContainText(pickedPath)
    expect(persisted).toBe(pickedPath)

    // RELOAD simulating an app restart. The route handler stays
    // armed; the GET should now return the persisted path.
    await page.reload()
    await page.locator('#tab-settings').click()

    // PIN THE BUG: the path must still be visible after reload.
    await expect(page.locator('.setting-value.mono')).toContainText(pickedPath)
  })

  test('on cold boot with an existing persisted folder, the path renders without re-picking', async ({ page }) => {
    // Simulate a user who picked the folder in a previous session —
    // settings.json already has it. The "stale state from real usage"
    // case: GET should return the value, and the UI should render
    // the steady-state row immediately on boot.
    const persistedPath = '/home/test/Documents/Overwatch/ScreenShots/Overwatch'

    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({ path: persistedPath }),
        })
        return
      }
      await route.continue()
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    await expect(page.locator('.setting-value.mono')).toContainText(persistedPath)
    // Empty-state hero must NOT render — the user already has a folder.
    await expect(page.locator('.empty-hero')).toHaveCount(0)
  })
})

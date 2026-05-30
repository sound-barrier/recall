/**
 * Engine row Detect / Change / Reset cluster — parity with the
 * screenshots-dir cluster shipped earlier.
 *
 * User report: "When I tried it on Windows it detected the folder,
 * but I had to pick the binary." The fix adds a Detect button that
 * walks per-OS install locations (Program Files, AppData, scoop,
 * Chocolatey on Windows; Homebrew + MacPorts on macOS; apt + snap on
 * Linux) plus PATH lookup, so the same Detect gesture lands a working
 * binary on more machines instead of forcing the user through the
 * picker.
 *
 * Reset replaces the older "Use default" link so the verb cluster
 * lines up visually with the screenshots-folder row.
 *
 * The spec mocks both the status endpoint and the new
 * /api/v1/system/tesseract-probe endpoint so the e2e doesn't depend
 * on whether the CI runner has Tesseract installed.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type Tesseract = {
  path: string
  found: boolean
  version: string
  supported: boolean
  error: string
  default: string
  platform: string
}

function defaultTess(over: Partial<Tesseract> = {}): Tesseract {
  return {
    path: '',
    found: false,
    version: '',
    supported: false,
    error: 'Tesseract path is empty — pick the binary in Settings → Engine.',
    default: '/usr/local/bin/tesseract',
    platform: 'darwin',
    ...over,
  }
}

function installTesseractRoute(page: import('@playwright/test').Page, initial: Tesseract) {
  let current = { ...initial }
  page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    const method = route.request().method()
    if (method === 'GET') {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(current),
      })
      return
    }
    if (method === 'PUT') {
      const body = route.request().postDataJSON() as { path?: string }
      if (body?.path) {
        current = { ...current, path: body.path, found: true, version: '5.5.0', supported: true, error: '' }
      }
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(current),
      })
      return
    }
    if (method === 'DELETE') {
      current = { ...current, path: current.default, found: true, version: '5.5.0', supported: true, error: '' }
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(current),
      })
      return
    }
    await route.continue()
  })
  return { get current() { return current } }
}

test.describe('settings — Engine row Detect / Reset', () => {
  test('Detect calls the probe endpoint and applies the discovered path', async ({ page }) => {
    installTesseractRoute(page, defaultTess({ path: '', found: false }))

    let probeCalls = 0
    await page.route('**/api/v1/system/tesseract-probe', async (route: Route) => {
      probeCalls++
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          found: true,
          path: '/opt/homebrew/bin/tesseract',
          tried: ['/opt/homebrew/bin/tesseract'],
        }),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Detect button is the primary CTA on the unhealthy Engine row.
    const detect = page.locator('#sec-engine button:has-text("Detect")')
    await expect(detect).toBeVisible()
    await expect(detect).not.toBeDisabled()
    await detect.click()

    await expect.poll(() => probeCalls).toBe(1)

    // After the round-trip the engine path updates to the discovered
    // location and the "Detected" pill flips on.
    await expect(page.locator('#sec-engine .engine-path')).toContainText('/opt/homebrew/bin/tesseract')
    await expect(page.locator('#sec-engine .engine-state')).toContainText('Detected')

    // And Detect is now disabled (binary is healthy → no need to probe).
    await expect(detect).toBeDisabled()
  })

  test('Detect shows the blocked chip + Looked-in disclosure when nothing is found', async ({ page }) => {
    installTesseractRoute(page, defaultTess({ path: '', found: false }))
    await page.route('**/api/v1/system/tesseract-probe', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          found: false,
          tried: ['/opt/homebrew/bin/tesseract', '/usr/local/bin/tesseract', '/opt/local/bin/tesseract'],
        }),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('#sec-engine button:has-text("Detect")').click()

    // Failure chip surfaces with the "blocked" styling + "Looked in"
    // disclosure carrying the candidate list.
    const chip = page.locator('#sec-engine .probe-chip')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('No Tesseract install found')

    const tried = page.locator('#sec-engine .probe-tried')
    await expect(tried).toBeVisible()
    await tried.locator('summary').click()
    await expect(tried).toContainText('/opt/homebrew/bin/tesseract')
  })

  test('Reset restores the platform default and disables itself', async ({ page }) => {
    installTesseractRoute(page, defaultTess({
      path: '/elsewhere/tesseract',
      found: true,
      version: '5.5.0',
      supported: true,
      error: '',
      default: '/usr/local/bin/tesseract',
    }))

    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Path is the override; Reset is enabled.
    await expect(page.locator('#sec-engine .engine-path')).toContainText('/elsewhere/tesseract')
    const reset = page.locator('#sec-engine button:has-text("Reset")')
    await expect(reset).not.toBeDisabled()

    await reset.click()
    // After Reset the in-memory + on-disk path is the platform default;
    // the rendered engine-path reflects that.
    await expect(page.locator('#sec-engine .engine-path')).toContainText('/usr/local/bin/tesseract')
    // And Reset becomes disabled (path matches default — no override
    // to clear).
    await expect(reset).toBeDisabled()
  })
})

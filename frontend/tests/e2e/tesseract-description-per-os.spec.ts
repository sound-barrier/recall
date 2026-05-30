/**
 * Engine row description shows only the host OS's install paths.
 *
 * User-reported confusion: the prior copy listed install paths for
 * every supported OS in one paragraph ("On macOS … apt installs to
 * /usr/bin … Windows installers put it in Program Files"). A non-
 * technical user reading this on their own machine had no signal
 * for which path to follow. Fix: surface only the platform-matching
 * paragraph, driven by tesseractStatus.platform (server-side
 * runtime.GOOS passthrough).
 *
 * Spec mocks the tesseract status endpoint per case so the e2e
 * doesn't depend on the platform the CI runner is actually on.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type Platform = 'darwin' | 'linux' | 'windows' | 'plan9'

async function mockTesseract(page: import('@playwright/test').Page, platform: Platform) {
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.continue()
      return
    }
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        path: '/configured/tesseract',
        found: true,
        version: '5.5.0',
        supported: true,
        error: '',
        default: '/configured/tesseract',
        platform,
      }),
    })
  })
}

test.describe('settings — Engine description per OS', () => {
  test('darwin renders only the Homebrew paths', async ({ page }) => {
    await mockTesseract(page, 'darwin')
    await page.goto('/')
    await page.locator('#tab-settings').click()

    const desc = page.locator('.engine-row .setting-desc')
    await expect(desc).toContainText('/opt/homebrew/bin')
    await expect(desc).toContainText('/usr/local/bin')
    await expect(desc).not.toContainText('Program Files')
    await expect(desc).not.toContainText('apt installs')
  })

  test('linux renders only the apt path', async ({ page }) => {
    await mockTesseract(page, 'linux')
    await page.goto('/')
    await page.locator('#tab-settings').click()

    const desc = page.locator('.engine-row .setting-desc')
    await expect(desc).toContainText('/usr/bin')
    await expect(desc).not.toContainText('Program Files')
    await expect(desc).not.toContainText('Homebrew')
  })

  test('windows renders only the Program Files path', async ({ page }) => {
    await mockTesseract(page, 'windows')
    await page.goto('/')
    await page.locator('#tab-settings').click()

    const desc = page.locator('.engine-row .setting-desc')
    await expect(desc).toContainText('Program Files')
    await expect(desc).toContainText('Tesseract-OCR')
    await expect(desc).not.toContainText('Homebrew')
    await expect(desc).not.toContainText('apt')
  })

  test('unknown platform falls back to just the lead sentence', async ({ page }) => {
    await mockTesseract(page, 'plan9')
    await page.goto('/')
    await page.locator('#tab-settings').click()

    const desc = page.locator('.engine-row .setting-desc')
    // Lead sentence stays so the row doesn't look broken.
    await expect(desc).toContainText('Tesseract')
    await expect(desc).toContainText('Overwatch screenshots')
    // No OS-specific paths leak through.
    await expect(desc).not.toContainText('Program Files')
    await expect(desc).not.toContainText('Homebrew')
    await expect(desc).not.toContainText('/usr/bin')
  })
})

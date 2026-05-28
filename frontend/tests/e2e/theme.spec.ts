/**
 * Theme E2E.
 *
 * Three modes (`dark` | `light` | `high-contrast`) live behind the
 * Settings → Appearance swatches. The high-contrast variant is
 * never auto-picked. First-launch fallback honours the OS-level
 * `prefers-color-scheme` so users running their OS in light mode
 * don't land on a dark UI for no reason.
 */
import { test, expect } from './_fixtures'

test.describe('theme — swatch selection', () => {
  test('clicking the Contrast swatch flips data-theme and persists', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-settings').click()

    // Three swatches, named via aria-label on the radiogroup +
    // role=radio on each. The Contrast swatch is the third entry.
    const contrast = page.locator('button.theme-swatch.contrast-swatch')
    await expect(contrast).toBeVisible()
    await contrast.click()

    // data-theme on <html> reflects the choice immediately.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast')

    // Reload → still high-contrast (localStorage roundtrip).
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast')
  })

  test('Day / Night swatches still work and switch live', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-settings').click()

    await page.locator('button.theme-swatch.light-swatch').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    await page.locator('button.theme-swatch.dark-swatch').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('active swatch carries aria-checked=true', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-settings').click()

    await page.locator('button.theme-swatch.contrast-swatch').click()
    await expect(page.locator('button.theme-swatch.contrast-swatch')).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('button.theme-swatch.dark-swatch')).toHaveAttribute('aria-checked', 'false')
    await expect(page.locator('button.theme-swatch.light-swatch')).toHaveAttribute('aria-checked', 'false')
  })
})

test.describe('theme — OS preference on fresh install', () => {
  // Per-test we clear the theme key AFTER the first goto via
  // `page.evaluate`, not via addInitScript — addInitScript fires on
  // every reload too, which would wipe the user's pick mid-test in
  // the "once picked, persists" case below.
  async function clearTheme(page: import('@playwright/test').Page) {
    await page.evaluate(() => { try { localStorage.removeItem('recall.theme') } catch (_) {} })
  }

  test('prefers-color-scheme: light → first paint is light', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' })
    await page.goto('/')
    await clearTheme(page)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('prefers-color-scheme: dark → first paint is dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await clearTheme(page)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  })

  test('OS preference never picks high-contrast on its own', async ({ page }) => {
    // Even forced contrast at the OS level lands on dark/light, not
    // high-contrast — high-contrast is opt-in only.
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await page.goto('/')
    await clearTheme(page)
    await page.reload()
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'high-contrast')
  })

  test('once the user picks any theme, OS preference no longer overrides', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.goto('/')
    await clearTheme(page)
    await page.locator('#tab-settings').click()
    await page.locator('button.theme-swatch.light-swatch').click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

    // OS flips to dark — user's `light` pick wins on reload.
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })
})

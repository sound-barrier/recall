/**
 * Application menu (the masthead ⋮ kebab — the browser/Windows/Linux surface;
 * macOS uses the native menu bar). Proves the full chain: clicking a menu item
 * opens the matching in-app dialog.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'
import { openAbout, openSettingsDialog, openAppMenu } from './_menu'

test.describe('application menu (⋮)', () => {
  test('About opens with the version + the unofficial-Overwatch disclaimer', async ({ page }) => {
    await page.route('**/api/v1/system/version', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '9.9.9' }) }))
    await page.goto('/')

    await openAbout(page)
    const dialog = page.locator('[data-about-modal]')
    await expect(dialog).toBeVisible()
    await expect(dialog.locator('[data-about-version]')).toContainText('v9.9.9')
    await expect(dialog.locator('[data-about-disclaimer]')).toContainText(/not affiliated/i)
  })

  test('Settings opens the Preferences-style dialog with the config sections', async ({ page }) => {
    await page.goto('/')

    await openSettingsDialog(page)
    const dialog = page.locator('[data-settings-modal]')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('heading', { name: 'Settings' })).toBeVisible()
    // The shared SettingsSections renders every configuration section.
    expect(await dialog.locator('.settings-section').count()).toBeGreaterThanOrEqual(5)
  })

  test('Settings dialog closes on Escape', async ({ page }) => {
    await page.goto('/')
    await openSettingsDialog(page)
    await expect(page.locator('[data-settings-modal]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[data-settings-modal]')).toBeHidden()
  })

  test('Keyboard shortcuts opens the cheatsheet from the menu', async ({ page }) => {
    await page.goto('/')
    await openAppMenu(page)
    await page.locator('[data-app-menu-shortcuts]').click()
    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible()
  })
})

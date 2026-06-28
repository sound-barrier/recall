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

  test('Settings dialog is a fixed-height modal: pinned header, only its body scrolls', async ({ page }) => {
    // Short viewport so the 7 settings sections overflow the dialog.
    await page.setViewportSize({ width: 1200, height: 700 })
    await page.goto('/')
    await openSettingsDialog(page)
    const dialog = page.locator('[data-settings-modal]')
    await expect(dialog).toBeVisible()

    // Background is scroll-locked while the dialog is open.
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflowY)).toBe('hidden')

    // The dialog BODY is the scroll container — the box is capped, so the
    // overlay never scrolls the whole box (that was the bug: the over-tall box
    // slid under a sticky header and the translucent backdrop read as the
    // background scrolling).
    const body = dialog.locator('.settings-modal-body')
    expect(await body.evaluate(el => el.scrollHeight > el.clientHeight + 4)).toBe(true)

    // The header is pinned to the TOP of the box (offset ~0) and stays there
    // while the body scrolls — it doesn't scroll away with the content.
    const headOffsetInBox = () => page.evaluate(() => {
      const box = document.querySelector('[data-settings-modal]')!.getBoundingClientRect()
      const head = document.querySelector('.settings-modal-head')!.getBoundingClientRect()
      return head.top - box.top
    })
    expect(await headOffsetInBox()).toBeLessThan(2)
    await body.evaluate(el => { el.scrollTop = el.scrollHeight })
    await page.waitForTimeout(50)
    expect(await body.evaluate(el => el.scrollTop)).toBeGreaterThan(20)
    expect(await headOffsetInBox()).toBeLessThan(2)
  })

  test('Keyboard shortcuts opens the cheatsheet from the menu', async ({ page }) => {
    await page.goto('/')
    await openAppMenu(page)
    await page.locator('[data-app-menu-shortcuts]').click()
    await expect(page.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeVisible()
  })
})

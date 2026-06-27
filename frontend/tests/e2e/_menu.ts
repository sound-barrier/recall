import type { Page } from '@playwright/test'

// The e2e runs the browser build, where the application menu is the masthead ⋮
// kebab (macOS would use the native menu bar instead). These helpers mirror the
// native menu's items so specs open the same dialogs the menu does.

export async function openAppMenu(page: Page) {
  await page.getByRole('button', { name: 'Application menu' }).click()
}

// About Recall — the version + update hub (folds in the old "Check for updates").
export async function openAbout(page: Page) {
  await openAppMenu(page)
  await page.locator('[data-app-menu-about]').click()
}

// Settings… — the Preferences-style dialog (mirrors the Settings tab).
export async function openSettingsDialog(page: Page) {
  await openAppMenu(page)
  await page.locator('[data-app-menu-settings]').click()
}

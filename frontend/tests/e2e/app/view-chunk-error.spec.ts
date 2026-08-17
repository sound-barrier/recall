import { expect } from '@playwright/test'

import { test } from '../_fixtures'

// A lazy view chunk that fails to load (network drop, or a redeploy
// that invalidated the old hashed filenames) must render a visible
// error state with a reload affordance — not a permanent skeleton or
// a blank pane (the audit's "defineAsyncComponent without error
// components" reliability gap).
test.describe('lazy view chunk failure', () => {
  test('shows an error state with a reload affordance when a view chunk fails', async ({ page }) => {
    // Block the Parse view's chunk before the app boots so the first
    // tab click hits the failure path. (IngestView keeps its own
    // chunk; SettingsView gets folded into a shared chunk by Vite's
    // splitter, so its name is not stable to glob.)
    await page.route('**/assets/IngestView-*.js', (route) => route.abort())

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()

    const errorState = page.locator('[data-view-error]')
    await expect(errorState).toBeVisible()
    await expect(errorState).toContainText(/failed to load/i)
    // role=alert so the failure is announced, not just painted.
    await expect(errorState).toHaveAttribute('role', 'alert')
    await expect(errorState.getByRole('button', { name: /reload/i })).toBeVisible()
  })

  test('reload affordance reloads the app and recovers once the chunk is servable', async ({ page }) => {
    let block = true
    await page.route('**/assets/IngestView-*.js', (route) => {
      if (block) return route.abort()
      return route.fallback()
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.locator('[data-view-error]')).toBeVisible()

    // The chunk becomes servable again (deploy finished / network
    // back); the reload button recovers the app.
    block = false
    await page.locator('[data-view-error]').getByRole('button', { name: /reload/i }).click()
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Parse' })).toBeVisible()
    await expect(page.locator('[data-view-error]')).toHaveCount(0)
  })
})

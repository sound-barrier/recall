/**
 * Import matches (merge) — proves the full transport chain for the
 * additive bundle import: file picker → api.ts POST /api/v1/imports →
 * {imported, skipped} summary → success chip / records reload. The merge
 * endpoint is mocked so the canned counts are deterministic and no real
 * bundle bytes are needed (the route intercepts before the Go handler).
 *
 * Both entry points are exercised: Settings → Backup & Restore and the
 * Matches-view list toolbar.
 */
import { test, expect } from './_fixtures'

// A few PK-magic bytes — content is irrelevant because the route mock
// intercepts the upload before it reaches the server.
const FAKE_BUNDLE = Buffer.from([0x50, 0x4b, 0x03, 0x04])

test.describe('Import matches (merge)', () => {
  test('Settings: importing a bundle shows the added/skipped chip', async ({ page }) => {
    let importHits = 0
    await page.route('**/api/v1/imports', route => {
      importHits++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imported: 2, skipped: 1 }),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await expect(page.locator('#tab-settings')).toHaveAttribute('aria-selected', 'true')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.getByRole('button', { name: /import matches/i }).click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({ name: 'bundle.zip', mimeType: 'application/zip', buffer: FAKE_BUNDLE })

    await expect(page.getByText('Imported 2 matches, skipped 1 already present')).toBeVisible()
    expect(importHits).toBe(1)
  })

  test('Matches view: the list toolbar import button POSTs the bundle', async ({ page }) => {
    let importHits = 0
    await page.route('**/api/v1/imports', route => {
      importHits++
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ imported: 1, skipped: 0 }),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('#tab-matches')).toHaveAttribute('aria-selected', 'true')

    const fileChooserPromise = page.waitForEvent('filechooser')
    await page.locator('[data-import-matches]').click()
    const fileChooser = await fileChooserPromise
    await fileChooser.setFiles({ name: 'bundle.zip', mimeType: 'application/zip', buffer: FAKE_BUNDLE })

    await expect.poll(() => importHits).toBe(1)
  })
})

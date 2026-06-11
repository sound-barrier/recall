/**
 * Restore-from-Settings round-trip.
 *
 * The "Delete forever" affordance on the Unknown tab shipped without
 * any undo path. Settings → Advanced now exposes:
 *   1. A Manage button that opens IgnoredFilesPanel — per-file Restore
 *      + bulk "Re-enable all" with a 2-step arm.
 *   2. A "Keep suppress-list" opt-out checkbox in the Clear Database
 *      arm step (the default Clear semantic wipes the suppress-list
 *      along with everything else).
 *
 * This spec exercises both flows end-to-end against mocked backend
 * routes — the same `page.route()` shape every other e2e in this
 * directory uses.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const PNG_BYTES = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108020000009077' +
  '53de00000001735247420aceec1ce90000000c4944415408d76360000000020001' +
  '008c39a90a0000000049454e44ae426082',
  'hex',
)

// Generic OW-shaped match record stub so the masthead count rendering
// doesn't NaN out on an empty matches payload.
const seedMatch = () => ({
  match_key:    'match-2026-05-01T10-00-00',
  source_files: ['summary-1.png'],
  source_types: { 'summary-1.png': 'summary' },
  data:         { map: 'rialto', playlist: 'competitive', hero: 'lucio', date: '2026-05-01' },
  parsed_at:    '2026-05-01T10:00:00Z',
})

test.describe('restore ignored screenshots — Settings → Advanced panel', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/_screenshot/**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: PNG_BYTES })
    })
  })

  test('Manage button is disabled when no files are ignored', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    const manageBtn = page.getByRole('button', { name: 'Manage…' })
    await expect(manageBtn).toBeDisabled()
  })

  test('Manage button opens the panel and lists every ignored file', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { filename: 'bad-1.png', ignored_at: '2026-06-04T15:00:00Z' },
          { filename: 'bad-2.png', ignored_at: '2026-06-04T14:00:00Z' },
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    const manageBtn = page.getByRole('button', { name: 'Manage…' })
    await expect(manageBtn).toBeEnabled()
    await manageBtn.click()

    await expect(page.locator('.ignored-backdrop')).toBeVisible()
    await expect(page.locator('.ignored-row')).toHaveCount(2)
    await expect(page.locator('.ignored-filename').first()).toHaveText('bad-1.png')
  })

  test('Per-row Restore fires DELETE on the per-file endpoint and shrinks the list', async ({ page }) => {
    let didDelete = false
    const initial = [
      { filename: 'bad-1.png', ignored_at: '2026-06-04T15:00:00Z' },
      { filename: 'bad-2.png', ignored_at: '2026-06-04T14:00:00Z' },
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(didDelete ? [initial[1]] : initial),
      })
    })
    await page.route('**/api/v1/screenshots/bad-1.png/ignore', async (route: Route) => {
      didDelete = true
      await route.fulfill({ status: 204 })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    await page.getByRole('button', { name: 'Manage…' }).click()

    await page.locator('.ignored-row').first().locator('button', { hasText: 'Restore' }).click()
    await expect(page.locator('.ignored-row')).toHaveCount(1)
    await expect(page.locator('.ignored-foot')).toContainText('Restored.')
  })

  test('Re-enable all is a 2-step arm: first click shows confirm, second fires bulk DELETE', async ({ page }) => {
    let didBulkDelete = false
    const initial = [
      { filename: 'a.png', ignored_at: '2026-06-04T15:00:00Z' },
      { filename: 'b.png', ignored_at: '2026-06-04T14:00:00Z' },
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      const body = didBulkDelete ? [] : initial
      if (route.request().method() === 'DELETE') {
        didBulkDelete = true
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    await page.getByRole('button', { name: 'Manage…' }).click()

    // First click arms — original button disappears, confirm + cancel appear.
    await page.locator('.ignored-restore-all').click()
    await expect(page.locator('.ignored-restore-all')).toHaveCount(0)
    await expect(page.locator('.ignored-restore-all-confirm')).toBeVisible()

    // Second click fires the bulk DELETE.
    await page.locator('.ignored-restore-all-confirm').click()
    await expect(page.locator('.ignored-row')).toHaveCount(0)
    await expect(page.locator('.ignored-empty')).toBeVisible()
  })

  test('Clear Database arm step renders the "Keep suppress-list" opt-out checkbox when files are ignored', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { filename: 'keep-me.png', ignored_at: '2026-06-04T15:00:00Z' },
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()

    // Arm Clear Database — the checkbox row only renders inside the
    // arm step (so users never see it unless they're about to wipe).
    await page.getByRole('button', { name: 'Clear Database…' }).click()
    const optOut = page.locator('.clear-keep-ignored')
    await expect(optOut).toBeVisible()
    await expect(optOut).toContainText('Keep the 1 ignored screenshot ')
  })

  test('Confirming Clear with the checkbox UN-checked omits keep_ignored=true', async ({ page }) => {
    let clearURL = ''
    await page.route(/\/api\/v1\/matches(\?.*)?$/, async (route: Route) => {
      const m = route.request().method()
      if (m === 'DELETE') {
        clearURL = route.request().url()
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ filename: 'go-away.png', ignored_at: '2026-06-04T15:00:00Z' }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    await page.getByRole('button', { name: 'Clear Database…' }).click()
    // Don't tick the checkbox — default factory-reset path.
    await page.getByRole('button', { name: /^Delete \d+ Record/ }).click()

    // Wait for the DELETE to fire (the composable awaits ClearDatabase).
    await expect.poll(() => clearURL, { timeout: 5_000 }).toMatch(/\/api\/v1\/matches/)
    expect(clearURL).not.toContain('keep_ignored=true')
  })

  test('Hovering a row pops a floating thumb; clicking the thumbnail opens the lightbox with arrow-nav across all ignored files', async ({ page }) => {
    await page.route(/\/api\/v1\/matches(\?.*)?$/, async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          { filename: 'first.png',  ignored_at: '2026-06-04T15:00:00Z' },
          { filename: 'second.png', ignored_at: '2026-06-04T14:00:00Z' },
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    await page.getByRole('button', { name: 'Manage…' }).click()

    // Hover the first row → cursor-anchored floating thumb appears.
    await page.locator('.ignored-row').first().hover()
    const hoverThumb = page.locator('.ignored-hover-thumb')
    await expect(hoverThumb).toBeVisible()
    await expect(hoverThumb).toHaveAttribute('src', /first\.png/)

    // Click the thumbnail → lightbox opens on that file.
    await page.locator('.ignored-row').first().locator('.ignored-thumb-btn').click()
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()
    await expect(lightbox.locator('img.lightbox-img')).toHaveAttribute('src', /first\.png/)

    // → arrow advances to the second ignored file (lightbox was
    // handed the full ignored-files list as its navigation set).
    await page.keyboard.press('ArrowRight')
    await expect(lightbox.locator('img.lightbox-img')).toHaveAttribute('src', /second\.png/)
    // ← goes back.
    await page.keyboard.press('ArrowLeft')
    await expect(lightbox.locator('img.lightbox-img')).toHaveAttribute('src', /first\.png/)

    // Esc closes the lightbox; the Manage panel beneath stays open.
    await page.keyboard.press('Escape')
    await expect(lightbox).toHaveCount(0)
    await expect(page.locator('.ignored-backdrop')).toBeVisible()
  })

  test('Ticking the opt-out checkbox routes through keep_ignored=true', async ({ page }) => {
    let clearURL = ''
    // Glob includes the **? suffix so the route matches both the
    // bare GET (no query string) AND the DELETE with
    // ?keep_ignored=true. Without the suffix Playwright's URL
    // matcher strictly compares against the full URL including
    // query and would miss the DELETE.
    await page.route(/\/api\/v1\/matches(\?.*)?$/, async (route: Route) => {
      const m = route.request().method()
      if (m === 'DELETE') {
        clearURL = route.request().url()
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([seedMatch()]),
      })
    })
    await page.route('**/api/v1/screenshots/ignored', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{ filename: 'keep-me.png', ignored_at: '2026-06-04T15:00:00Z' }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    await page.locator('summary.advanced-summary').click()
    // Wait for the suppress-list GET to land so the checkbox row mounts
    // alongside the rest of the arm step (the v-if gates on ignoredCount).
    await expect(page.getByRole('button', { name: 'Manage…' })).toBeEnabled()
    await page.getByRole('button', { name: 'Clear Database…' }).click()
    const checkbox = page.locator('.clear-keep-ignored input[type="checkbox"]')
    await expect(checkbox).toBeVisible()
    await checkbox.check()
    await page.getByRole('button', { name: /^Delete \d+ Record/ }).click()

    await expect.poll(() => clearURL, { timeout: 5_000 }).toContain('keep_ignored=true')
  })
})

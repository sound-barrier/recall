/**
 * Unknown tab — hover an entry reveals a small floating thumbnail
 * of the first source screenshot, without expanding the card.
 *
 * Pairs with the existing click-to-expand preview (covered in
 * `unknown-tab-screenshot-lightbox.spec.ts`); this is the lower-
 * friction triage path:
 *   - hover → quick peek at the screenshot
 *   - click → full card expand + per-file thumbnails + lightbox
 *
 * The hover preview is suppressed once the card is expanded — the
 * source-preview thumbnails inside the expanded body already cover
 * that need, and overlapping floating thumbs would just be noise.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// 1×1 PNG stub so the <img> actually paints in the headless browser.
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

async function stubScreenshotBytes(page: import('@playwright/test').Page) {
  await page.route('**/_screenshot/**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
  })
}

const unknownRecord = {
  match_key: 'unmatched:broken.png',
  source_files: ['broken.png'],
  source_types: { 'broken.png': 'unknown' },
  data: {},
  parsed_at: '2026-05-10T21:00:00Z',
}

test.describe('Unknown tab — hover preview', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('hover an Unknown card reveals a small floating thumbnail; mouseleave hides it', async ({ page }) => {
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([unknownRecord]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    const card = page.locator('.unknown-card').first()
    await expect(card).toBeVisible()

    // No thumbnail before hover.
    await expect(page.locator('.unknown-hover-thumb')).toHaveCount(0)

    // Hover the row → thumbnail surfaces with the first source file's URL.
    await card.hover()
    const thumb = page.locator('.unknown-hover-thumb')
    await expect(thumb).toBeVisible()
    await expect(thumb).toHaveAttribute('src', /_screenshot\/broken\.png/)

    // Move the mouse away → thumbnail goes away.
    await page.mouse.move(0, 0)
    await expect(thumb).toHaveCount(0)
  })

  test('does NOT render the hover thumbnail when the card is already expanded', async ({ page }) => {
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([unknownRecord]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Expand the card.
    await page.locator('.unknown-card .unknown-card-head').first().click()
    // Now hovering must NOT spawn a floating thumb — the body
    // already carries inline source-preview thumbnails.
    await page.locator('.unknown-card').first().hover()
    await expect(page.locator('.unknown-hover-thumb')).toHaveCount(0)
  })

  test('records without any source_files do not render a hover thumbnail', async ({ page }) => {
    const noSources = { ...unknownRecord, source_files: [] }
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([noSources]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.unknown-card').first().hover()
    await expect(page.locator('.unknown-hover-thumb')).toHaveCount(0)
  })
})

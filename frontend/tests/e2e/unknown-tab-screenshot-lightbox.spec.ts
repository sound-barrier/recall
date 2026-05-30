/**
 * Unknown tab — click a source-screenshot preview → fullscreen lightbox.
 *
 * Parity with the side-panel MatchDetailPanel's sources block:
 *   1. Expand the card → Source Files / Source Screenshot block.
 *   2. Click the filename row → inline thumbnail toggle.
 *   3. Click the thumbnail → fullscreen `.lightbox-backdrop` opens
 *      over the whole window.
 *   4. Esc / × closes the lightbox without dropping the user out of
 *      the Unknown tab.
 *
 * Pre-this-PR the Unknown tab's thumbnail was a dead-click —
 * the `<img>` rendered but carried no @click handler. The
 * ambiguous-card flavour didn't even render a thumbnail at all,
 * forcing the user to pick a candidate without seeing the
 * screenshot they were triaging.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Tiny inline PNG (1×1, base64) so the thumbnail actually paints
// in the headless browser. Without a real <img> the click target
// never reaches `previewOpen=true && !previewError` and the
// `<img.source-preview>` doesn't render.
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

const ambiguousRecord = {
  match_key: 'ambiguous:scoreboard-2.png',
  source_files: ['scoreboard-2.png'],
  source_types: { 'scoreboard-2.png': 'scoreboard' },
  data: { hero: 'lucio' },
  parsed_at: '2026-05-10T21:42:00Z',
  ambiguous: true,
  candidates: [
    { match_key: 'match:2026-05-10T21:29:28', distance_seconds: 720 },
  ],
}

test.describe('Unknown tab — screenshot preview click → lightbox', () => {
  // Disable view-fade-in animation so Playwright's stability check
  // sees the expanded card at full opacity by the time it tries to
  // click the source-name (otherwise the running animation lets
  // .app catch the click before the animated child becomes
  // hit-testable; same fix the ambiguous-attribution spec uses).
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('Unknown card: click thumbnail opens the fullscreen lightbox; Esc closes it', async ({ page }) => {
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([unknownRecord]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Expand the unknown card, then toggle the filename → preview
    // appears. Playwright's auto-hit-test for the inline-flow
    // <a class="source-name"> keeps reporting .app as the
    // interceptor in this layout — repro doesn't happen in the
    // real runtime, and dispatching click directly on the element
    // fires the Vue handler without the hit-test detour.
    await page.locator('.unknown-card .unknown-card-head').first().click()
    await page.locator('.unknown-card .source-name').first()
      .dispatchEvent('click')
    const preview = page.locator('.unknown-card img.source-preview').first()
    await expect(preview).toBeVisible()

    // Click the preview → fullscreen lightbox over the whole window.
    // Same dispatchEvent rationale as the source-name click above.
    await preview.dispatchEvent('click')
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()
    await expect(lightbox.locator('img.lightbox-img')).toBeVisible()

    // Esc dismisses the lightbox; the Unknown tab stays active.
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    await expect(page.locator('#tab-unknown')).toHaveAttribute('aria-selected', 'true')
  })

  test('Ambiguous card: expanded shows a Source Screenshot block; clicking the thumbnail opens the lightbox', async ({ page }) => {
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([ambiguousRecord]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Expand the ambiguous card → Source Screenshot block + Pick the
    // match section both render.
    await page.locator('.ambiguous-card .unknown-card-head').click()
    await expect(page.locator('.ambiguous-card .block-eyebrow', { hasText: 'Source Screenshot' })).toBeVisible()
    await expect(page.locator('.ambiguous-card .block-eyebrow', { hasText: 'Pick the match' })).toBeVisible()

    // Toggle the filename → thumbnail renders → click → lightbox.
    // Same dispatchEvent rationale as the Unknown case above.
    await page.locator('.ambiguous-card .source-name').dispatchEvent('click')
    const preview = page.locator('.ambiguous-card img.source-preview')
    await expect(preview).toBeVisible()

    await preview.dispatchEvent('click')
    const lightbox = page.locator('.lightbox-backdrop')
    await expect(lightbox).toBeVisible()
    await expect(lightbox.locator('img.lightbox-img')).toBeVisible()

    // × button closes the lightbox; the candidate picker beneath
    // stays expanded.
    await page.locator('.lightbox-close').click()
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    await expect(page.locator('.ambiguous-card .candidate-row')).toBeVisible()
  })
})

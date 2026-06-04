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
  match_key: 'unmatched-broken.png',
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
    // URL shape: /_screenshot/<dir-id>/<filename>. Record has no
    // source_dir_ids so the frontend sends dir-id 0 (fallback path).
    await expect(thumb).toHaveAttribute('src', /_screenshot\/0\/broken\.png/)

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

  test('thumbnail follows the cursor and edge-flips at the right side of the viewport', async ({ page }) => {
    await stubScreenshotBytes(page)
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([unknownRecord]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    // Hover the card near the left side of the viewport — the
    // 360 px-wide thumb should anchor below-right of the cursor,
    // so left > clientX.
    await page.locator('.unknown-card').first().hover({ position: { x: 60, y: 30 } })
    const thumb = page.locator('.unknown-hover-thumb')
    await expect(thumb).toBeVisible()

    const styleLeft = await thumb.evaluate((el) => (el as HTMLElement).style.left)
    const styleTop  = await thumb.evaluate((el) => (el as HTMLElement).style.top)
    // Inline style is `<n>px`. We don't assert exact values (cursor
    // coords differ from .hover() position coords); only that an
    // anchor was written + parses to a positive integer.
    expect(Number.parseInt(styleLeft, 10)).toBeGreaterThan(0)
    expect(Number.parseInt(styleTop, 10)).toBeGreaterThan(0)

    // Move the cursor — position should update.
    const before = styleLeft
    await page.locator('.unknown-card').first().hover({ position: { x: 240, y: 40 } })
    const after = await thumb.evaluate((el) => (el as HTMLElement).style.left)
    expect(after).not.toBe(before)
  })

  test('preloads each Unknown record\'s first source file on view mount (warm the browser cache before the user hovers)', async ({ page }) => {
    // The regression this guards: until the screenshot bytes were in
    // the browser cache, a quick hover-then-leave would set the
    // thumb's src, start a fetch, then on mouseleave unmount the
    // element which cancels the in-flight request. The image never
    // landed. After the user clicked into the expanded view (whose
    // inline source-preview img mounts and STAYS mounted), the
    // screenshot finally cached and only THEN did subsequent hovers
    // surface the image. Fix preloads on view mount so the cache is
    // warm before any hover.
    const fetched: string[] = []
    await page.route('**/_screenshot/**', async (route) => {
      fetched.push(new URL(route.request().url()).pathname)
      await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          unknownRecord,
          { ...unknownRecord, match_key: 'unmatched-other.png', source_files: ['other.png'] },
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await expect(page.locator('.unknown-card')).toHaveCount(2)

    // The preload should fire on view mount — both records' first
    // source files are fetched BEFORE the user has moved the mouse.
    await expect.poll(() => fetched.sort().join(','), { timeout: 3000 })
      .toContain('/_screenshot/0/broken.png')
    expect(fetched).toContain('/_screenshot/0/other.png')
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

  // Touch-pointer fallback: long-press on a collapsed card peeks the
  // thumb the same way mouse hover does (touch devices have no
  // hover state). Tap (short press) still falls through to the
  // existing click-to-expand.
  test('touch long-press on an Unknown card reveals the thumbnail; pointerup hides it', async ({ page }) => {
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

    // No thumbnail before the press.
    await expect(page.locator('.unknown-hover-thumb')).toHaveCount(0)

    // Dispatch a synthetic touch-pointer down + hold > 500 ms.
    // We script the events directly because Playwright's
    // touchscreen helper doesn't drive pointer events, and the
    // long-press timer keys off pointerType === 'touch'.
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    await card.evaluate((el, [x, y]) => {
      const ev = new PointerEvent('pointerdown', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
      })
      el.dispatchEvent(ev)
    }, [cx, cy])

    // Wait past the long-press threshold (500 ms in the SFC).
    await page.waitForTimeout(600)
    const thumb = page.locator('.unknown-hover-thumb')
    await expect(thumb).toBeVisible()
    await expect(thumb).toHaveAttribute('src', /_screenshot\/0\/broken\.png/)

    // Release → thumb hides.
    await card.evaluate((el, [x, y]) => {
      const ev = new PointerEvent('pointerup', {
        pointerType: 'touch',
        clientX: x,
        clientY: y,
        bubbles: true,
      })
      el.dispatchEvent(ev)
    }, [cx, cy])
    await expect(thumb).toHaveCount(0)
  })

  test('touch short tap does NOT peek and falls through to click-to-expand', async ({ page }) => {
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
    const box = await card.boundingBox()
    expect(box).not.toBeNull()
    const cx = box!.x + box!.width / 2
    const cy = box!.y + box!.height / 2

    // Quick tap — pointerdown then pointerup well under 500 ms.
    await card.evaluate((el, [x, y]) => {
      el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }))
      el.dispatchEvent(new PointerEvent('pointerup',   { pointerType: 'touch', clientX: x, clientY: y, bubbles: true }))
    }, [cx, cy])

    // No peek thumb appeared (it never fired the timer).
    await expect(page.locator('.unknown-hover-thumb')).toHaveCount(0)
  })
})

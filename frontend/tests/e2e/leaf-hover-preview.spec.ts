/**
 * Leaf-row hover preview (item 4).
 *
 * Hovering a leaf row floats a SUMMARY-screenshot thumbnail next
 * to the cursor. The cursor coords drive the preview's transform
 * so it tracks mousemove. Mouseleave clears it. Touch viewports
 * suppress the preview via a CSS media-query gate (display:none
 * under `(hover: none) or (pointer: coarse)`).
 *
 * The spec drives a real `mouse.move(x, y)` over the first leaf
 * row's bounding box, then asserts the preview is mounted + its
 * `<img>` carries the SUMMARY screenshot's URL.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T22-00-00'
const SUMMARY_FILE = `${KEY}_summary.png`

// A real, decodable 1×1 PNG. An invalid stub (e.g. just the PNG signature)
// makes the browser fire `error` on the <img>, which the preview now treats as
// a missing screenshot and hides — so the bytes must actually decode.
const STUB_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

function record(matchKey: string) {
  return {
    match_key: matchKey,
    source_files: [SUMMARY_FILE],
    source_types: { [SUMMARY_FILE]: 'summary' },
    // The server only sends thumbnail_file when the image exists on disk; the
    // hover preview renders nothing without it.
    thumbnail_file: SUMMARY_FILE,
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('leaf-row hover preview', () => {
  test('mouseenter on a leaf row mounts a cursor-anchored preview img', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })
    // The screenshot URL is served by the host's ScreenshotHandler; return a
    // real PNG so the <img> decodes (an undecodable stub would fire `error`,
    // which the preview now treats as a missing screenshot).
    await page.route('**/_screenshot/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: STUB_PNG,
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    const row = page.locator('.leaf-row').first()
    await row.hover()

    const preview = page.locator('.leaf-hover-preview')
    await expect(preview).toBeVisible()
    const img = preview.locator('img')
    await expect(img).toHaveAttribute('src', new RegExp(SUMMARY_FILE))
  })

  test('a match with no on-disk screenshot shows no preview and never requests one', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      // No thumbnail_file → the server found no on-disk image for this match
      // (a data-only import / deleted screenshot).
      const rec = record(KEY) as Record<string, unknown>
      delete rec.thumbnail_file
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rec]) })
    })
    let screenshotRequested = false
    await page.route('**/_screenshot/**', async (route: Route) => {
      screenshotRequested = true
      await route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().hover()

    // No thumbnail appears, and the frontend never even tried to fetch one.
    await expect(page.locator('.leaf-hover-preview img')).toHaveCount(0)
    expect(screenshotRequested).toBe(false)
  })

  test('mouseleave clears the preview', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })
    await page.route('**/_screenshot/**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: STUB_PNG })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    const row = page.locator('.leaf-row').first()
    await row.hover()
    await expect(page.locator('.leaf-hover-preview')).toBeVisible()
    // Move the mouse off the row.
    await page.mouse.move(0, 0)
    await expect(page.locator('.leaf-hover-preview')).toHaveCount(0)
  })
})

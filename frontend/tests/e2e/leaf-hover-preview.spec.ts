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

function record(matchKey: string) {
  return {
    match_key: matchKey,
    source_files: [SUMMARY_FILE],
    source_types: { [SUMMARY_FILE]: 'summary' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
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
    // The screenshot URL is served by the host's ScreenshotHandler;
    // a 200 with an empty PNG body is enough for the <img> to attach.
    await page.route('**/_screenshot/**', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'image/png',
        body: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
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

  test('mouseleave clears the preview', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })
    await page.route('**/_screenshot/**', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from([]) })
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

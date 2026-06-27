/**
 * Members-toolbar overflow regression.
 *
 * The members-section header controls (Add / Import / Sort / Density / Sections
 * / Undated) sit on the right of a space-between row. When they can't fit beside
 * the title they must WRAP within the panel — before the fix they overflowed the
 * panel's right border, with the "N undated" button spilling outside the members
 * set. This reproduces at a maximized 14"/16" laptop width (~1440-1650px).
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function rec(i: number, undated = false) {
  return {
    match_key: `match-2026-05-${10 + i}T2${i % 6}-0${i % 6}-0${i % 6}`,
    source_files: [], source_types: {}, source: 'ocr',
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
      result: 'victory', date: undated ? '' : `2026-05-${10 + i}`, finished_at: '21:00',
      eliminations: 12, assists: 14, deaths: 6, heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: `2026-05-${10 + i}T23:30:00Z`,
  }
}

test.describe('members toolbar', () => {
  for (const w of [1500, 1600]) {
    test(`the undated button stays inside the members panel at ${w}px`, async ({ page }) => {
      const records = [
        ...Array.from({ length: 10 }, (_, i) => rec(i)),
        ...Array.from({ length: 3 }, (_, i) => rec(20 + i, true)),
      ]
      await page.route('**/api/v1/matches', (route: Route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) }))

      await page.setViewportSize({ width: w, height: 1000 })
      await page.goto('/')
      await page.locator('#tab-matches').click()
      const btn = page.locator('[data-jump-to-undated]').first()
      await btn.scrollIntoViewIfNeeded()
      await expect(btn).toBeVisible()

      const panel = await page.locator('.leaves').first().boundingBox()
      const button = await btn.boundingBox()
      expect(panel).not.toBeNull()
      expect(button).not.toBeNull()
      // The button's right edge must not cross the panel's right border.
      expect(button!.x + button!.width).toBeLessThanOrEqual(panel!.x + panel!.width)
    })
  }
})

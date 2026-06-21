/**
 * Data-table frozen leading columns.
 *
 * The select + Date columns stay pinned to the left while the wider columns
 * scroll under them, so you never lose track of which match a row is. A narrow
 * viewport forces the table to overflow its pane horizontally.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, map: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map,
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

async function thX(page: Page, col: string): Promise<number> {
  return (await page.locator(`.leaves-thead th[data-sort-col="${col}"]`).boundingBox())!.x
}

test.describe('data table — frozen leading columns', () => {
  test('Date stays pinned while the wider columns scroll under it', async ({ page }) => {
    await page.setViewportSize({ width: 760, height: 800 })
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('m1', 'rialto'), record('m2', 'busan')]),
      }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await toDataDensity(page)

    const dateBefore = await thX(page, 'date')
    const heroBefore = await thX(page, 'hero')

    await page.locator('.leaves-table-scroll').evaluate((el) => { el.scrollLeft = 240 })

    const dateAfter = await thX(page, 'date')
    const heroAfter = await thX(page, 'hero')

    // Date is frozen — its on-screen x doesn't move.
    expect(Math.abs(dateAfter - dateBefore)).toBeLessThan(4)
    // Hero is not frozen — it scrolled left under the frozen columns.
    expect(heroBefore - heroAfter).toBeGreaterThan(120)
  })
})

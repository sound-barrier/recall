/**
 * Data-table click-to-filter.
 *
 * Clicking a categorical cell value (Map, Result) toggles that narrow
 * dimension — an Excel-style autofilter on top of the narrow panel — so the
 * set shrinks to rows matching the clicked value without opening the panel.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, map: string, result: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map,
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result,
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

test.describe('data table — click a cell to filter', () => {
  test('a map cell narrows to that map; a result cell stacks on top', async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('m1', 'rialto', 'victory'),
          record('m2', 'busan', 'victory'),
          record('m3', 'rialto', 'defeat'),
        ]),
      }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await toDataDensity(page)
    await expect(page.locator('tr.table-row')).toHaveCount(3)

    // Click a rialto map cell → narrow to rialto (m1 + m3 remain, busan gone).
    await page.locator('tr.table-row[data-match-key="m1"] .tc-map .tc-filter-cell').click()
    await expect(page.locator('tr.table-row')).toHaveCount(2)
    await expect(page.locator('tr.table-row[data-match-key="m2"]')).toHaveCount(0)
    // The filter click did NOT open the detail panel.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)

    // Click m3's defeat result → stacks (rialto AND defeat) → m3 alone.
    await page.locator('tr.table-row[data-match-key="m3"] .tc-result .tc-filter-cell').click()
    await expect(page.locator('tr.table-row')).toHaveCount(1)
    await expect(page.locator('tr.table-row[data-match-key="m3"]')).toHaveCount(1)
  })
})

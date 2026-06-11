/**
 * Row-packing migration. A pre-existing layout where every opt-in
 * widget got its own single-widget overflow row (the buggy state the
 * old `appendToRow` shipped) auto-consolidates on first mount into
 * shape-coherent packed rows.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

// The user's exact broken state: every opt-in widget got its own
// single-cell overflow row.
const BROKEN_LAYOUT = {
  '1': ['winrate', 'avg-kda', 'total-time', 'most-played-hero', 'reviewed-count', 'days-since-review', 'wld-since-review'],
  '2': ['top-maps', 'top-heroes', 'top-roles', 'recent-5-matches'],
  '3': ['current-streak'],
  '4': ['hero-pool-size'],
  '5': ['longest-win-streak'],
  '6': ['best-winrate-hero'],
  '7': ['time-of-day'],
  '8': ['day-of-week'],
  '9': ['top-map-types'],
}

test.describe('dashboard pack rows migration', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    await page.addInitScript((seed) => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify(seed))
      localStorage.removeItem('recall.dashboard.layoutVersion')
    }, BROKEN_LAYOUT)
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  test('one-time migration packs single-widget overflow rows into denser rows', async ({ page }) => {
    // Before: 9 rows. After: defaults (rows 1, 2) + one packed KPI row
    // (3) + one packed breakdown row (4) = 4 widget rows.
    const rows = page.locator('.dashboard-row')
    await expect(rows).toHaveCount(4)

    await expect(page.locator('.dashboard-row[data-row="3"] [data-widget-id]')).toHaveCount(4)
    await expect(page.locator('.dashboard-row[data-row="4"] [data-widget-id]')).toHaveCount(3)

    const stored = await page.evaluate(() => ({
      layout: JSON.parse(localStorage.getItem('recall.dashboard.layout') ?? '{}'),
      version: localStorage.getItem('recall.dashboard.layoutVersion'),
    }))
    expect(stored.version).toBe('1')
    expect(Object.keys(stored.layout)).toEqual(['1', '2', '3', '4'])
  })
})

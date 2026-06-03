/**
 * Row packing + AddTile placement.
 *
 * Three contracts:
 *   1. A pre-existing layout where every opt-in widget got its own
 *      single-widget overflow row (the buggy state shipped by the
 *      old `appendToRow`) is auto-consolidated on first mount into
 *      shape-coherent packed rows.
 *   2. The "+ Add widget" tile lives in its own dedicated row
 *      (`.dashboard-add-row`), NOT in any widget grid row. It can
 *      never sit alongside widget controls.
 *   3. Spanning 2 grid tracks per breakdown widget keeps the dense
 *      multi-row dossier from visually overlapping.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

// Mirrors the user's exact broken state from localStorage at the
// time the bug was reported: every opt-in widget got its own
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

test.describe('dashboard pack rows + add-tile relocation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    // Seed the broken layout in localStorage BEFORE the page loads
    // so the consolidation migration runs against it on first
    // composable init.
    await page.addInitScript((seed) => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify(seed))
      localStorage.removeItem('recall.dashboard.layoutVersion')
    }, BROKEN_LAYOUT)
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  test('one-time migration packs single-widget overflow rows into denser rows', async ({ page }) => {
    // Before migration: 9 rows (defaults + 7 single-widget overflows).
    // After migration: defaults (rows 1, 2) plus one packed row of
    // opt-in KPIs (row 3) and one packed row of opt-in breakdowns
    // (row 4) = 4 widget rows total.
    const rows = page.locator('.dashboard-row')
    await expect(rows).toHaveCount(4)

    // Verify the row contents match the consolidated shape.
    const row3 = page.locator('.dashboard-row[data-row="3"] [data-widget-id]')
    await expect(row3).toHaveCount(4)
    const row4 = page.locator('.dashboard-row[data-row="4"] [data-widget-id]')
    await expect(row4).toHaveCount(3)

    // localStorage now reflects the migrated layout AND the version
    // sentinel is stamped so this won't run again.
    const stored = await page.evaluate(() => ({
      layout: JSON.parse(localStorage.getItem('recall.dashboard.layout') ?? '{}'),
      version: localStorage.getItem('recall.dashboard.layoutVersion'),
    }))
    expect(stored.version).toBe('1')
    expect(Object.keys(stored.layout)).toEqual(['1', '2', '3', '4'])
  })

  test('AddTile lives in its own dedicated .dashboard-add-row, not inside any widget grid row', async ({ page }) => {
    await page.locator('input[data-edit-toggle]').check()

    // The tile is present, exactly once, INSIDE .dashboard-add-row.
    const addRow = page.locator('.dashboard-add-row')
    await expect(addRow).toBeVisible()
    await expect(addRow.locator('[data-add-tile]')).toHaveCount(1)

    // It is NEVER a child of a .dashboard-row (widget grid).
    const addInGrid = page.locator('.dashboard-row [data-add-tile]')
    await expect(addInGrid).toHaveCount(0)
  })

  test('AddTile disappears when edit mode is off', async ({ page }) => {
    // VIEW mode: no add row at all.
    await expect(page.locator('.dashboard-add-row')).toHaveCount(0)
    // EDIT mode: it shows.
    await page.locator('input[data-edit-toggle]').check()
    await expect(page.locator('.dashboard-add-row')).toHaveCount(1)
    // Toggle back off via the banner Done button.
    await page.locator('[data-edit-banner-exit]').click()
    await expect(page.locator('.dashboard-add-row')).toHaveCount(0)
  })
})

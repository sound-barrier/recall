/**
 * Per-widget gear-icon settings popover.
 *
 * End-to-end proof:
 *
 *   user clicks the gear on a widget with a non-empty schema
 *     → popover mounts; segmented integer-choice row reflects the
 *       current limit (default 3)
 *     → clicks limit=10
 *     → clicks Save
 *     → popover closes; localStorage holds {limit: 10}
 *     → widget re-renders showing 10 rows (or fewer if dataset
 *       can't supply that many)
 *     → reload → settings persist
 *
 * Settings live on their own axis from layout edits: the gear is
 * always visible when the widget has a non-empty schema, regardless
 * of edit mode. Edit mode is for moving widgets; the gear is for
 * tuning what one shows.
 *
 * Also verifies: empty-schema widgets (e.g. winrate) don't render
 * the gear button.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

// 12 distinct heroes worth of play time so the limit-10 selection
// renders 10 rows (the dossier's topHeroesByMinutes will slice to
// the limit).
function manyHeroMatches() {
  const heroes = [
    'lucio', 'mercy', 'ana', 'baptiste', 'kiriko', 'juno',
    'reinhardt', 'orisa', 'sigma', 'soldier', 'tracer', 'pharah',
  ]
  return heroes.map((hero, i) => ({
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero,
      result: 'victory', date: `2026-05-${String(10 + i).padStart(2, '0')}`,
      finished_at: '22:00',
      eliminations: 10, assists: 5, deaths: 3,
      heroes_played: [{ hero, percent_played: 100, play_time: '12:00' }],
    },
    parsed_at: `2026-05-${String(10 + i).padStart(2, '0')}T22:30:00Z`,
  }))
}

test.describe('widget-config popover — gear → save → persist', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(manyHeroMatches()),
      })
    })
  })

  test('empty-schema widgets do not render the gear icon', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    // No edit-mode toggle needed — gear visibility is independent of
    // layout edits and lives wherever a widget has a config schema.
    await expect(page.locator('[data-widget-config-trigger="winrate"]')).toHaveCount(0)
  })

  test('gear opens popover; Save persists; widget re-renders', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Default top-heroes renders 3 rows.
    const heroList = page.locator('[data-widget-id="top-heroes"] li')
    await expect(heroList).toHaveCount(3)

    // Gear is always present — no edit mode, no select-click required.
    const gear = page.locator('[data-widget-config-trigger="top-heroes"]')
    await expect(gear).toBeVisible()
    await gear.click()
    const popover = page.getByTestId('widget-config-popover')
    await expect(popover).toBeVisible()

    // Pick limit=10 + Save.
    await page.locator('[data-widget-config-choice="limit=10"]').click()
    await page.getByTestId('widget-config-save').click()
    await expect(popover).toHaveCount(0)

    // Widget grew to 10 rows.
    await expect(heroList).toHaveCount(10)

    // Reload — config persists.
    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('[data-widget-id="top-heroes"] li')).toHaveCount(10)
  })

  test('Cancel discards the draft', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-widget-config-trigger="top-heroes"]').click()
    await page.locator('[data-widget-config-choice="limit=10"]').click()
    await page.getByTestId('widget-config-cancel').click()
    await expect(page.getByTestId('widget-config-popover')).toHaveCount(0)
    // Still 3 rows.
    await expect(page.locator('[data-widget-id="top-heroes"] li')).toHaveCount(3)
  })
})

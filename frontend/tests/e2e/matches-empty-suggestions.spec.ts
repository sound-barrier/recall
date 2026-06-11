/**
 * Smart-empty filter messaging (item 6).
 *
 * When the narrow excludes every record, surface the top 1-2
 * "Try removing X" suggestions. Clicking one calls that clause's
 * clear() so the user contracts the narrow in a single click.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, hero: string, map: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map,
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero,
      result: 'victory',
      date: matchKey.slice(6, 16),
      finished_at: '22:00',
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${matchKey.slice(6, 16)}T22:30:00Z`,
  }
}

test.describe('smart-empty filter suggestions', () => {
  test('selecting a hero that has no matches surfaces a "Remove hero" suggestion + clicking it reverts', async ({ page }) => {
    const records = [
      record('match-2026-05-10T22-00-00', 'lucio',   'rialto'),
      record('match-2026-05-11T22-00-00', 'mercy',   'rialto'),
      record('match-2026-05-12T22-00-00', 'lucio',   'ilios'),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Open the narrow popover and search for a string that doesn't
    // appear anywhere — that excludes every record without needing
    // to coerce a combobox to accept a non-existent option.
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('#np-search').fill('zzzz-no-such-text')
    // Close the popover so the leaves list paints; the empty-state
    // suggestion only surfaces on the visible list.
    await page.keyboard.press('Escape')

    const suggestion = page.locator('.empty-suggestion-btn').first()
    await expect(suggestion).toBeVisible()
    await expect(suggestion).toContainText(/Remove search/i)

    // Clicking removes the search clause; the list re-populates.
    await suggestion.click()
    await expect(page.locator('.leaf-row')).toHaveCount(records.length)
  })
})

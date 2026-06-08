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
      mode: 'competitive',
      type: 'control',
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

    // Open the narrow panel and pick a hero NOT in the corpus.
    await page.locator('[data-test="open-narrow"], button.dossier-actions-narrow').first().click()
      .catch(async () => {
        // Older selector fallback — keep this loose, the trigger
        // moves around as the masthead evolves.
        await page.locator('button:has-text("Narrow")').first().click()
      })

    // Type into the hero combobox.
    const heroCombo = page.locator('[data-combo-id="hero"] input.combo-input').first()
    await heroCombo.fill('ana')
    await heroCombo.press('Enter') // free-text adopt via TypeaheadDropdown

    // Now the narrow excludes every record. Empty suggestions surface.
    const suggestion = page.locator('.empty-suggestion-btn').first()
    await expect(suggestion).toBeVisible()
    await expect(suggestion).toContainText(/Remove (hero|3 hero picks)/i)

    // Clicking removes the clause; the list re-populates.
    await suggestion.click()
    await expect(page.locator('.leaf-row')).toHaveCount(records.length)
  })
})

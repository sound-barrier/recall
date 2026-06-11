/**
 * Saved-set / preset feature (UI_RECOMMENDATIONS item 8).
 *
 * Configure a narrow → save it under a name → reload → click the
 * named preset → narrow re-applies. localStorage round-trip is the
 * heart of the contract.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, hero: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      type: 'control',
      role: hero === 'lucio' ? 'support' : 'dps',
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

test.describe('saved-set / narrow presets', () => {
  test('save current narrow → reload → apply the named preset re-narrows the set', async ({ page }) => {
    const records = [
      record('match-2026-05-10T22-00-00', 'lucio'),
      record('match-2026-05-11T22-00-00', 'tracer'),
      record('match-2026-05-12T22-00-00', 'lucio'),
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

    // Open narrow popover (the trigger button is on the dossier).
    await page.locator('[data-narrow-trigger]').click()

    // Pick a hero → narrow to lucio matches. ArrowDown moves the
    // cursor to the first option, Enter then selects it (TypeaheadDropdown's
    // free-text emit doesn't route through FilterCombobox).
    const heroCombo = page.locator('[data-combo-id="hero"] input.combo-input').first()
    await heroCombo.fill('lucio')
    await heroCombo.press('ArrowDown')
    await heroCombo.press('Enter')

    // Save the narrow under "comp clutch".
    await page.locator('[data-presets-save-input]').fill('comp clutch')
    await page.locator('[data-presets-save-btn]').click()

    // The named preset surfaces immediately + persists across reload.
    await expect(page.locator('[data-preset-name="comp clutch"]')).toBeVisible()

    await page.reload()
    await page.locator('#tab-matches').click()
    await page.locator('[data-narrow-trigger]').click()
    await expect(page.locator('[data-preset-name="comp clutch"]')).toBeVisible()

    // Narrow state is fresh after the reload — every record is
    // visible. Clicking the saved preset re-narrows to the lucio
    // subset (2 of the 3 records).
    await expect(page.locator('.leaf-row')).toHaveCount(records.length)
    await page.locator('[data-preset-name="comp clutch"]').click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })
})

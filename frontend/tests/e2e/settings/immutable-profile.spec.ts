/**
 * Read-only sample profile — the tour's "test" profile is immutable, so the UI
 * disables every write affordance (parse, import, manual-add, restore) and marks
 * the masthead chip. Enforcement is server-side (409); this proves the UI
 * reflects it so a user never clicks into an error.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [],
}

const ONE_MATCH = [{
  match_key: 'm1',
  source_files: ['1.png'],
  parsed_at: '2026-05-10T12:00:00Z',
  data: {
    map: 'ilios', playlist: 'competitive', hero: 'lucio', result: 'victory',
    date: '2026-05-10', finished_at: '12:00', played_at_utc: '2026-05-10T12:00:00Z',
  },
}]

function mockProfiles(immutable: string[]) {
  return async (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ active: 'test', profiles: ['main', 'test'], immutable }),
    })
}

test.describe('immutable sample profile', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONE_MATCH) }))
  })

  test('read-only profile disables every write affordance + marks the chip', async ({ page }) => {
    await page.route('**/api/v1/profiles', mockProfiles(['test']))
    await page.goto('/')

    // Masthead chip carries the read-only lock.
    await expect(page.locator('[data-profile-readonly]')).toBeVisible()

    // Parse tab: the read-only note shows and Run Parse + Watch are disabled.
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.locator('[data-readonly-note]')).toBeVisible()
    await expect(page.getByTestId('run-parse-btn')).toBeDisabled()
    await expect(page.locator('.big-switch input[type="checkbox"]')).toBeDisabled()

    // Matches tab: Add match + Import are disabled.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-add-match]')).toBeDisabled()
    await expect(page.locator('[data-import-matches]')).toBeDisabled()
  })

  test('a normal profile keeps the write affordances enabled', async ({ page }) => {
    await page.route('**/api/v1/profiles', mockProfiles([])) // nothing immutable
    await page.goto('/')

    await expect(page.locator('[data-profile-readonly]')).toHaveCount(0)
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-add-match]')).toBeEnabled()
    await expect(page.locator('[data-import-matches]')).toBeEnabled()
  })
})

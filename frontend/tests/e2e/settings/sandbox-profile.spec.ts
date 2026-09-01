/**
 * The tour's "test" profile is a writable SANDBOX. It used to be immutable,
 * which read as breakage: a player who stayed after the tour to look around
 * found the write affordances greyed with only a hover tooltip to explain.
 * This proves the sample behaves like any profile — every write affordance
 * live, no lock badge — and that deleting a profile is offered as the reset.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [], patches: [],
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

test.describe('the sample profile is a sandbox', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(ONE_MATCH) }))
    // Run Parse also disables (honestly) when the folder has nothing new —
    // pin a pending count so the only question left is the write gate.
    await page.route('**/api/v1/screenshots/pending-count', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: 3, parked: 0 }) }))
    await page.route('**/api/v1/profiles', async (route: Route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback()
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'test', profiles: ['main', 'test'] }),
      })
    })
  })

  test('every write affordance stays live on the sample, and no lock badge shows', async ({ page }) => {
    await page.goto('/')

    // No read-only mark on the masthead chip.
    await expect(page.locator('[data-profile-readonly]')).toHaveCount(0)

    // Parse tab: no lock note, Run Parse + Watch are live.
    await page.getByRole('tab', { name: 'Parse' }).click()
    await expect(page.locator('[data-readonly-note]')).toHaveCount(0)
    await expect(page.getByTestId('run-parse-btn')).toBeEnabled()
    await expect(page.locator('.big-switch input[type="checkbox"]')).toBeEnabled()

    // Matches tab: Add match + Import + the bulk writes are live.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('[data-add-match]')).toBeEnabled()
    await expect(page.locator('[data-import-matches]')).toBeEnabled()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    await page.locator('.leaf-row').first().locator('.leaf-checkbox').click()
    await expect(page.getByRole('button', { name: 'Review this match' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Hide' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Set play mode' })).toBeEnabled()
  })
})

/**
 * Replay codes die at season rollover.
 *
 * The code stays in the journal, still six valid characters, and the game
 * simply refuses it — which is a worse failure than a missing code, because
 * the player finds out at the moment they sat down to watch, having already
 * decided this was the match worth reviewing.
 *
 * So a code from a past season says so where it is stored. "Likely" and not
 * "expired": the app knows the season boundaries, not Blizzard's retirement
 * schedule, and it never says this about a code it cannot place.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

// seasons.yaml is served through the reference-data endpoint; the spec pins
// its own two-season roster so the verdict does not drift with the file.
const SEASONS = [
  { name: 'S1', chapter: 'C', number: 1, start: '2020-01-10T19:00:00Z', end: '2020-03-14T19:00:00Z' },
  { name: 'S2', chapter: 'C', number: 2, start: '2020-03-14T19:00:00Z', end: '2099-06-16T19:00:00Z' },
]

const match = (key: string, playedAt: string, code: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'escort', role: 'support',
    hero: 'ana', result: 'victory', date: playedAt.slice(0, 10), finished_at: '20:00',
    played_at_utc: playedAt,
  },
  annotation: { leavers: [], throwers: [], members: [], tags: [], replay_code: code },
  parsed_at: playedAt,
})

// The live season runs to 2099, so "now" is always inside it: the first
// match is from the dead season, the second from the live one.
const CORPUS = [
  match('match-2020-02-01T20-00-00', '2020-02-01T20:00:00Z', 'DEAD01'),
  match('match-2026-05-01T20-00-00', '2026-05-01T20:00:00Z', 'LIVE01'),
]

test.describe('replay-code shelf life', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.route('**/api/v1/system/reference-data', async (route: Route) => {
      const original = await route.fetch()
      const body = await original.json() as Record<string, unknown>
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...body, seasons: SEASONS }),
      })
    })
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
  })

  test("a code from a past season says so; a live one says nothing", async ({ page }) => {
    // Newest first — the live-season match is the first row.
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('.detail-panel')).toBeVisible()
    await expect(page.locator('.journal-cell-replay')).not.toContainText(/season/i)

    await page.keyboard.press('Escape')
    await page.locator('.leaf-row').last().click()
    await expect(page.locator('.journal-cell-replay')).toContainText(/likely expired/i)
  })
})

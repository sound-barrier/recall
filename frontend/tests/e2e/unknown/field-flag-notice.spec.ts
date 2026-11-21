/**
 * A reading the cross-check flagged stays out of the stats until reviewed.
 *
 * The server attaches `field_flags` to a match whose readings disagree; the
 * app reads every flag still `open` as a field it must not count. Three
 * surfaces say so: the number itself drops out (here, the masthead's W/L/D
 * tally skips a flagged result), the dossier carries "N fields left out of
 * your stats pending review" with the way to the review, and the Unknown tab's
 * badge counts each open flag as work waiting. A flag the player already
 * confirmed leaves nothing out and asks for nothing.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

type FlagState = 'open' | 'confirmed' | 'edited'

const flag = (field: string, value: string, state: FlagState) => ({
  field,
  value,
  checks: ['result_vs_rank_movement'],
  state,
  readings: [
    { source_file: 'summary.png', origin: 'ocr', value },
    { source_file: 'rank.png', origin: 'derived', value: 'defeat' },
  ],
})

const match = (key: string, finishedAt: string, flags: ReturnType<typeof flag>[]) => ({
  match_key: key,
  source_files: ['summary.png', 'rank.png'],
  source_types: { 'summary.png': 'summary', 'rank.png': 'rank' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
    result: 'victory', date: '2026-05-10', finished_at: finishedAt,
    eliminations: 17, assists: 16, deaths: 11, damage: 7200, healing: 9100,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
  },
  ...(flags.length > 0 ? { field_flags: flags } : {}),
  parsed_at: '2026-05-10T23:00:00Z',
})

async function serveMatches(page: import('@playwright/test').Page, flagState: FlagState) {
  const records = [
    match('match-2026-05-10T22-00-00', '22:00', []),
    match('match-2026-05-10T22-30-00', '22:30', [
      flag('data.result', 'victory', flagState),
      flag('data.heroes_played', 'lucio', flagState),
    ]),
  ]
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) })
  })
}

// The masthead scoreboard's Won count, the first of its three numbers.
const wins = (page: import('@playwright/test').Page) =>
  page.getByRole('group', { name: 'Record' }).locator('.score-num').first()

test.describe('flagged readings — left out until reviewed', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('an open flag drops its field from the tally, says so, and badges Unknown', async ({ page }) => {
    await serveMatches(page, 'open')
    await page.goto('/')

    // The flagged victory is left out; the clean one still counts.
    await expect(wins(page)).toHaveText('1')

    // Only the result is a value left out; the hero-list flag is review
    // work that leaves the match whole.
    const notice = page.getByRole('status', { name: 'Readings left out of your stats' })
    await expect(notice).toContainText('1 field left out of your stats pending review')

    // Both open flags are work waiting on the Unknown tab.
    await expect(page.getByRole('tab', { name: 'Unknown 2 unresolved' })).toBeVisible()

    await notice.getByRole('button', { name: 'Review flagged readings' }).click()
    await expect(page.getByRole('tab', { name: /^Unknown/ })).toHaveAttribute('aria-selected', 'true')
  })

  test('a confirmed flag counts again and asks for nothing', async ({ page }) => {
    await serveMatches(page, 'confirmed')
    await page.goto('/')

    await expect(wins(page)).toHaveText('2')
    await expect(page.getByRole('status', { name: 'Readings left out of your stats' })).toHaveCount(0)
    // exact: a name string matches any substring, so 'Unknown' alone would
    // also find a badged 'Unknown 2 unresolved'.
    await expect(page.getByRole('tab', { name: 'Unknown', exact: true })).toBeVisible()
    await expect(page.getByRole('tab', { name: /unresolved/ })).toHaveCount(0)
  })
})

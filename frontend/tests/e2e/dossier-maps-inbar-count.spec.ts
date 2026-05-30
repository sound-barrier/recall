/**
 * Most played maps — in-bar play-count label.
 *
 * Parity with the Most-played-heroes row: each map row now renders
 * an in-bar `Nx` label (e.g. `1x`, `3x`, `4x`) inside `.bd-bar`,
 * matching the visual treatment of the heroes' `XhYmin` / `Ymin`
 * label. The share-percent stays on the right in `.bd-stats`.
 *
 * Why the redundancy: a 33% share on a 3-match corpus reads
 * identically to a 33% share on a 30-match corpus, but the user's
 * gut needs the absolute count to interpret it. The hero row solves
 * this by surfacing total play time in-bar; the map row was
 * count-based but only ever rendered the percent — so the absolute
 * count was lost. Reinstating it inside the bar keeps the right-
 * hand stat column lean while restoring the volume read.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (key: string, map: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map,
    mode: 'competitive',
    hero: 'lucio',
    result: 'victory',
    date: '2026-05-10',
    finished_at: '14:00',
    game_length: '10:00',
    heroes_played: [{ hero: 'lucio', play_time: '10:00', percent_played: 100 }],
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

// Mix: rialto×3, numbani×2, lijiang×1 — total 6 records, three maps,
// each row's count is distinct so a regression that renders "1x"
// on every line would be obvious.
const CORPUS = [
  match('m1', 'rialto'),
  match('m2', 'rialto'),
  match('m3', 'rialto'),
  match('m4', 'numbani'),
  match('m5', 'numbani'),
  match('m6', 'lijiang'),
]

test.describe('dossier — Most played maps in-bar count', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('renders the play-count as `Nx` inside each .bd-bar', async ({ page }) => {
    const rows = page.locator('.breakdown', { hasText: 'Most played maps' }).locator('li')
    await expect(rows).toHaveCount(3)

    await expect(rows.nth(0).locator('.bd-name')).toHaveText('rialto')
    await expect(rows.nth(0).locator('.bd-bar .bd-time')).toHaveText('3x')

    await expect(rows.nth(1).locator('.bd-name')).toHaveText('numbani')
    await expect(rows.nth(1).locator('.bd-bar .bd-time')).toHaveText('2x')

    await expect(rows.nth(2).locator('.bd-name')).toHaveText('lijiang')
    await expect(rows.nth(2).locator('.bd-bar .bd-time')).toHaveText('1x')
  })

  test('keeps the share percentage in .bd-stats on the right', async ({ page }) => {
    const rows = page.locator('.breakdown', { hasText: 'Most played maps' }).locator('li')
    // 3 / 6 = 50%, 2 / 6 = 33%, 1 / 6 = 17% (Math.round).
    await expect(rows.nth(0).locator('.bd-stats')).toHaveText('50%')
    await expect(rows.nth(1).locator('.bd-stats')).toHaveText('33%')
    await expect(rows.nth(2).locator('.bd-stats')).toHaveText('17%')
  })
})

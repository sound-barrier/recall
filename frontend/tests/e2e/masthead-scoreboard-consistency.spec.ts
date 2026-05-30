/**
 * Masthead scoreboard ↔ Record KPI consistency E2E.
 *
 * The W/L/D shown in the top-right masthead and the Record KPI tile
 * inside MatchesView's dossier must agree on every visible match in
 * the current narrow. Before the fix the masthead used the legacy
 * `useMatchFilters` pipeline (which silently dropped undated rows,
 * i.e. matches whose result was inferred from a rank-screen SR
 * change but with no SUMMARY-supplied date) while the Record tile
 * used `useMatchesNarrow` (which keeps undated rows in by default).
 * The user saw 1-1-0 in the masthead and 2-1-0 in the Record tile
 * for the same set.
 *
 * This spec mocks the live-DB shape (2 dated W/L + 1 undated rank-
 * inferred W) and pins both readouts at 2-1-0.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const CORPUS = [
  {
    match_key: 'match:2026-05-10T21:29:28',
    source_files: ['aatlis-summary.png', 'aatlis-scoreboard.png'],
    source_types: {
      'aatlis-summary.png': 'summary',
      'aatlis-scoreboard.png': 'scoreboard',
    },
    data: {
      map: 'aatlis',
      hero: 'lucio',
      mode: 'competitive',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '21:29',
      eliminations: 17,
      assists: 14,
      deaths: 7,
    },
    parsed_at: '2026-05-10T21:30:00Z',
  },
  {
    match_key: 'match:2026-05-10T21:49:34',
    source_files: ['rialto-summary.png'],
    source_types: { 'rialto-summary.png': 'summary' },
    data: {
      map: 'rialto',
      hero: 'wuyang',
      mode: 'competitive',
      result: 'defeat',
      date: '2026-05-10',
      finished_at: '21:08',
      eliminations: 7,
      assists: 6,
      deaths: 3,
    },
    parsed_at: '2026-05-10T21:50:00Z',
  },
  // Suravasa: rank-inferred victory, no SUMMARY → no date / finished_at.
  // Before the fix this row counted in the Record tile but not the
  // masthead. Spec pins both at 2-1-0.
  {
    match_key: 'match:2026-05-10T22:21:11',
    source_files: ['suravasa-scoreboard.png', 'suravasa-rank.png'],
    source_types: {
      'suravasa-scoreboard.png': 'scoreboard',
      'suravasa-rank.png': 'rank',
    },
    data: {
      map: 'suravasa',
      hero: 'lucio',
      mode: 'competitive',
      result: 'victory',
      eliminations: 17,
      assists: 16,
      deaths: 11,
    },
    parsed_at: '2026-05-10T22:22:00Z',
  },
]

test.describe('masthead scoreboard ↔ Record KPI consistency', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('masthead and Record tile both report 2-1-0', async ({ page }) => {
    const masthead = page.locator('.scoreboard .score-num')
    await expect(masthead).toHaveCount(3)
    await expect(masthead.nth(0)).toHaveText('2') // wins
    await expect(masthead.nth(1)).toHaveText('1') // losses
    await expect(masthead.nth(2)).toHaveText('0') // draws

    const recordTile = page.locator('.kpi-tile', { hasText: 'Record' })
    await expect(recordTile.locator('.t-w')).toHaveText('2')
    await expect(recordTile.locator('.t-l')).toHaveText('1')
    await expect(recordTile.locator('.t-d')).toHaveText('0')
  })
})

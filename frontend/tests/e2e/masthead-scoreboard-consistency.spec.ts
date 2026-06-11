/**
 * Masthead scoreboard W/L/D regression E2E.
 *
 * The W/L/D in the top-right masthead must count undated rank-
 * inferred wins (e.g. a Suravasa victory whose result came from the
 * rank screen's SR change but has no SUMMARY-supplied date) — the
 * same set the MatchesView dossier shows. Before #110 the masthead
 * sourced from the legacy `useMatchFilters` pipeline that silently
 * dropped undated rows, so the user saw "1-1-0" in the masthead
 * even though the dossier KPIs counted the undated win.
 *
 * The Record KPI tile that the original spec asserted parity
 * against was replaced by Avg K/D/A in a later iteration. The
 * masthead remains the canonical W/L/D surface; this spec keeps
 * the regression pin on it with the same live-DB shape.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const CORPUS = [
  {
    match_key: 'match-2026-05-10T21-29-28',
    source_files: ['aatlis-summary.png', 'aatlis-scoreboard.png'],
    source_types: {
      'aatlis-summary.png': 'summary',
      'aatlis-scoreboard.png': 'teams',
    },
    data: {
      map: 'aatlis',
      hero: 'lucio',
      playlist: 'competitive',
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
    match_key: 'match-2026-05-10T21-49-34',
    source_files: ['rialto-summary.png'],
    source_types: { 'rialto-summary.png': 'summary' },
    data: {
      map: 'rialto',
      hero: 'wuyang',
      playlist: 'competitive',
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
    match_key: 'match-2026-05-10T22-21-11',
    source_files: ['suravasa-scoreboard.png', 'suravasa-rank.png'],
    source_types: {
      'suravasa-scoreboard.png': 'teams',
      'suravasa-rank.png': 'rank',
    },
    data: {
      map: 'suravasa',
      hero: 'lucio',
      playlist: 'competitive',
      result: 'victory',
      eliminations: 17,
      assists: 16,
      deaths: 11,
    },
    parsed_at: '2026-05-10T22:22:00Z',
  },
]

test.describe('masthead scoreboard W/L/D — undated rank-inferred wins', () => {
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

  test('masthead reports 2-1-0 including the undated rank-inferred win', async ({ page }) => {
    const masthead = page.locator('.scoreboard .score-num')
    await expect(masthead).toHaveCount(3)
    await expect(masthead.nth(0)).toHaveText('2') // wins (aatlis + suravasa)
    await expect(masthead.nth(1)).toHaveText('1') // losses (rialto)
    await expect(masthead.nth(2)).toHaveText('0') // draws
  })
})

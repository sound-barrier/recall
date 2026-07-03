import { expect } from '@playwright/test'

import { test } from './_fixtures'

// Session rollups (audit product gap #1, the top value-for-effort
// pick): group the match list by play session — consecutive matches
// with less than a 3-hour gap, the same rule the momentum widgets
// already use — with a divider carrying the session's W/L/D, its
// time span, and its average line. The data was always there; this
// makes "how did tonight go?" a glance.

function rec(key: string, date: string, finishedAt: string, result: 'victory' | 'defeat', ead: [number, number, number]) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', hero: 'lucio', role: 'support', result,
      date, finished_at: finishedAt,
      eliminations: ead[0], assists: ead[1], deaths: ead[2],
    },
  }
}

// One day, two sessions: a morning pair (10:00 / 10:30) and an
// evening pair (19:00 / 19:30) — the 8.5h gap splits them.
const CORPUS = [
  rec('s1a', '2026-05-10', '10:00', 'victory', [20, 10, 6]),
  rec('s1b', '2026-05-10', '10:30', 'victory', [24, 12, 8]),
  rec('s2a', '2026-05-10', '19:00', 'defeat', [12, 8, 12]),
  rec('s2b', '2026-05-10', '19:30', 'victory', [18, 9, 9]),
]

test.describe('session grouping', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }))
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  test('grouping by session splits on the time gap and rolls up W/L + span', async ({ page }) => {
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-group-pick="session"]').check()

    const dividers = page.locator('.section-divider')
    await expect(dividers).toHaveCount(2)

    // Newest-first: the evening session leads with its 1W 1L rollup
    // and 30-minute span; the morning session shows 2W.
    const evening = dividers.first()
    await expect(evening.locator('[data-session-rollup]')).toContainText('1W')
    await expect(evening.locator('[data-session-rollup]')).toContainText('1L')
    await expect(evening).toContainText(/19:00.*19:30|7:00.*7:30/)

    const morning = dividers.nth(1)
    await expect(morning.locator('[data-session-rollup]')).toContainText('2W')
    await expect(morning.locator('[data-session-rollup]')).not.toContainText('1L')
  })

  test('the session choice persists in the sort/group label', async ({ page }) => {
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-group-pick="session"]').check()
    await expect(page.locator('[data-sort-group-trigger]')).toContainText(/by session/i)
  })
})

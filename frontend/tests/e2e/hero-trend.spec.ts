import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Per-hero trend over time (audit product gap #2): "improving on
// Juno, regressing on Ana" — the Trends charts plotted only the
// whole narrowed set (per role). A sixth chart plots the rolling
// win-rate per hero for the set's most-played heroes, so a hero's
// own trajectory is visible instead of being averaged away.

function match(key: string, date: string, time: string, hero: string, result: 'victory' | 'defeat') {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', hero, role: 'support', result,
      date, finished_at: time,
    },
  }
}

// Two heroes with enough decisive matches to chart: juno trending up,
// ana trending down.
const CORPUS = [
  match('j1', '2026-05-01', '20:00', 'juno', 'defeat'),
  match('j2', '2026-05-02', '20:00', 'juno', 'victory'),
  match('j3', '2026-05-03', '20:00', 'juno', 'victory'),
  match('a1', '2026-05-01', '21:00', 'ana', 'victory'),
  match('a2', '2026-05-02', '21:00', 'ana', 'defeat'),
  match('a3', '2026-05-03', '21:00', 'ana', 'defeat'),
]

async function mockMatches(page: import('@playwright/test').Page, records: unknown[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(records) }))
}

test.describe('per-hero win-rate trend', () => {
  test('renders the hero win-rate chart with a per-hero caption', async ({ page }) => {
    await mockMatches(page, CORPUS)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.trends-toggle').click()

    const card = page.locator('[data-trend-card="hero-winrate"]')
    await expect(card).toBeVisible()
    await expect(card).toContainText(/win-rate by hero/i)
    await expect(card.locator('canvas')).toBeVisible()
  })

  test('drops out gracefully when no hero has decisive matches', async ({ page }) => {
    // A decisive match with NO hero keeps the rolling-winrate chart
    // (and thus the section) alive while the hero series stays empty.
    await mockMatches(page, [
      { match_key: 'm1', source_files: ['m1.png'], data: { map: 'rialto', role: 'support', result: 'victory', date: '2026-05-01', finished_at: '20:00' } },
    ])
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.trends-toggle').click()

    const card = page.locator('[data-trend-card="hero-winrate"]')
    await expect(card).toContainText(/no.*data|nothing to chart/i)
  })
})

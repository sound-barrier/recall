/**
 * Dossier KPI — Average K/D/A per 10min.
 *
 * The "Record" tile that used to surface W·L·D was replaced. W/L/D
 * still ships in the masthead scoreboard (top right); the dossier
 * now reads "Avg K/D/A per 10min" — averaging each match's
 * `performance.{eliminations,deaths,assists}.avg_per_10min` straight
 * across the tally-eligible records. Display rounds to hundredths
 * with epsilon-shifted round-half-away-from-zero so 12.135 → 12.14
 * instead of the naive toFixed(2) → 12.13.
 *
 * K/D/A order is Kills (eliminations) / Deaths / Assists — the
 * canonical gaming-stat convention. Coverage hint ("N of M matches")
 * surfaces when not every record contributed performance data.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const matchWith = (
  key: string,
  perf?: { e: number; d: number; a: number },
) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto',
    mode: 'competitive',
    hero: 'lucio',
    result: 'victory',
    date: '2026-05-10',
    finished_at: '14:00',
    ...(perf
      ? {
        performance: {
          eliminations: { total: 0, avg_per_10min: perf.e },
          deaths:       { total: 0, avg_per_10min: perf.d },
          assists:      { total: 0, avg_per_10min: perf.a },
        },
      }
      : {}),
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

test.describe('dossier — Avg K/D/A per 10min', () => {
  test('renames the Record tile and surfaces the averaged value', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          matchWith('m1', { e: 14.87, d: 6.12, a: 12.25 }),
          matchWith('m2', { e: 9.40,  d: 4.03, a: 8.06  }),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    // Old eyebrow is gone.
    await expect(page.locator('.kpi-eyebrow', { hasText: /^Record$/ })).toHaveCount(0)

    const tile = page.locator('.kpi-tile', { hasText: 'Avg K/D/A per 10min' })
    // (14.87 + 9.4) / 2 = 12.135 → 12.14 with the epsilon shift.
    // (6.12 + 4.03) / 2 = 5.075  → 5.08.
    // (12.25 + 8.06) / 2 = 10.155 → 10.16.
    await expect(tile.locator('.kpi-value')).toHaveText('12.14 / 5.08 / 10.16')
    // Both records contributed — no coverage hint.
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })

  test('renders em-dash when no record carries performance data', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([matchWith('m1'), matchWith('m2')]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Avg K/D/A per 10min' })
    await expect(tile.locator('.kpi-value')).toHaveText('—')
  })

  test('discloses coverage when only some records have performance data', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          matchWith('m1', { e: 10, d: 5, a: 8 }),
          matchWith('m2'), // no performance
          matchWith('m3'), // no performance
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Avg K/D/A per 10min' })
    await expect(tile.locator('.kpi-value')).toHaveText('10.00 / 5.00 / 8.00')
    await expect(tile.locator('.kpi-sub')).toHaveText('1 of 3 matches')
  })
})

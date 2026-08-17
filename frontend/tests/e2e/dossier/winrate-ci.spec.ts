/**
 * Winrate confidence-interval E2E.
 *
 * The dossier's Winrate KPI carries a Wilson 95% interval as its
 * sub-line ("± 24 pts · n=14") so a thin sample can't masquerade as a
 * solid rate. Sub-line absent when there are no decisive matches.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

function rec(i: number, result: string) {
  const day = String((i % 27) + 1).padStart(2, '0')
  return {
    match_key: `match-2026-05-${day}T1${i % 10}-0${i % 6}-00`,
    source_files: [`m${i}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      hero: 'lucio',
      result,
      date: `2026-05-${day}`,
      finished_at: `1${i % 10}:0${i % 6}`,
      eliminations: 10,
      assists: 3,
      deaths: 4,
    },
    parsed_at: `2026-05-${day}T23:00:00Z`,
  }
}

test.describe('winrate confidence interval', () => {
  test('KPI sub-line shows the ± margin and sample size', async ({ page }) => {
    const corpus = [
      ...Array.from({ length: 9 }, (_, i) => rec(i, 'victory')),
      ...Array.from({ length: 5 }, (_, i) => rec(i + 9, 'defeat')),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus) })
    })

    await page.goto('/')

    const kpi = page.locator('[data-widget-id="winrate"]')
    await expect(kpi).toContainText('64%')
    // Wilson 95% for 9/14: ≈ [38.6%, 83.7%] → ± ≈ 23 pts.
    await expect(kpi.locator('.winrate-ci')).toContainText(/± ?2\d pts · n=14/)
  })

  test('no decisive matches — no interval line', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rec(1, 'draw')]) })
    })

    await page.goto('/')
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
    await expect(page.locator('.winrate-ci')).toHaveCount(0)
  })
})

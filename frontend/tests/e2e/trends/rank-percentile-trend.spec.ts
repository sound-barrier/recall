/**
 * Trends — "Ranked above" percentile over time.
 *
 * The rank-ladder chart plots ladderScore(), a synthetic tier/level/progress
 * composite whose y-axis means nothing outside this app. rank_percentile is
 * the one rank number that is ground truth straight off the screenshot, so it
 * gets a chart on a real 0–100 axis.
 *
 * SPARSITY IS THE DESIGN CONSTRAINT, not an edge case. Only post-placement
 * season-4 rank screens report a percentile — 3 of 89 golden captures today —
 * so this series is a handful of points across a set of hundreds, and the
 * cases below are built that way on purpose.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

interface Stub {
  role?: 'tank' | 'dps' | 'support'
  percentile?: number
}

const match = (key: string, date: string, time: string, s: Stub) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto',
    playlist: 'competitive',
    role: s.role ?? 'support',
    hero: { tank: 'reinhardt', dps: 'ashe', support: 'juno' }[s.role ?? 'support'],
    result: 'victory',
    rank: 'platinum',
    level: 2,
    rank_progress: 40,
    date,
    finished_at: time,
    ...(s.percentile === undefined ? {} : { rank_percentile: s.percentile }),
  },
  parsed_at: `${date}T${time}:00Z`,
})

async function openTrends(
  page: import('@playwright/test').Page,
  records: unknown[],
) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify(records),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await page.getByRole('button', { name: /Trends/i }).first().click()
  return page.locator('[data-trend-card="rank-percentile"]')
}

test.describe('rank percentile over time', () => {
  test('charts the readings that reported a percentile', async ({ page }) => {
    const card = await openTrends(page, [
      match('m1', '2026-08-10', '20:00', { percentile: 52 }),
      match('m2', '2026-08-12', '20:00', { percentile: 57 }),
      match('m3', '2026-08-14', '20:00', { percentile: 61 }),
    ])

    await expect(card).toBeVisible()
    await expect(card.locator('.trend-chart canvas')).toHaveCount(1)
  })

  // The sparse case is the REAL one: most matches in a set will never carry a
  // percentile, and the chart must plot the few that do rather than reading the
  // silence as data.
  test('plots the few readings inside a set that mostly has none', async ({ page }) => {
    const records = [
      ...Array.from({ length: 12 }, (_, i) =>
        match(`plain${i}`, '2026-08-0' + ((i % 8) + 1), '20:00', {})),
      match('p1', '2026-08-10', '20:00', { percentile: 52 }),
      match('p2', '2026-08-14', '20:00', { percentile: 61 }),
    ]
    const card = await openTrends(page, records)

    await expect(card).toBeVisible()
    await expect(card.locator('.trend-chart canvas')).toHaveCount(1)
  })

  // "No capture has reported one yet" is a different fact from "you have no
  // rank screenshots", and the copy has to say which.
  test('explains itself when no capture reported a percentile', async ({ page }) => {
    const card = await openTrends(page, [
      match('m1', '2026-08-10', '20:00', {}),
      match('m2', '2026-08-12', '20:00', {}),
    ])

    await expect(card).toBeVisible()
    await expect(card.locator('.trend-chart canvas')).toHaveCount(0)
    await expect(card).toContainText(/percentile/i)
  })

  // THE LADDER TOOLTIP IS NOT ASSERTED HERE, deliberately.
  //
  // Its three readings are all nullable and an unread one must be omitted, but
  // ECharts paints into a canvas and shows its tooltip only while the pointer
  // rests on a plotted point — which this harness could not drive reliably. Two
  // successive attempts to assert it here PASSED against a deliberately broken
  // formatter, because a negative assertion against an element that never
  // rendered is indistinguishable from a real pass, and the surrounding page
  // happens to contain the tier string anyway (the Current rank widget prints
  // it).
  //
  // The formatter is therefore covered where it can actually fail:
  // trend-options.test.ts drives it directly with null progress, null movement
  // and null percentile. That test was verified to fail against the raw
  // template. A vacuous e2e is worse than no e2e — it reports coverage that
  // does not exist.
})

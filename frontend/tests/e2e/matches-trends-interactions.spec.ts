/**
 * Matches — Trends chart interactions (brush → narrow, click → open).
 *
 * The trends charts mirror the Campaign Log's brushable feel via ECharts:
 * an always-on lineX brush turns a drag into a time-range selection that
 * sets the narrow's custom date range (scoping the whole workspace), and a
 * click on the plot opens the nearest match's detail panel (resolved at the
 * DOM level via convertFromPixel, since the brush cursor swallows ECharts'
 * own click). A bottom zoom/pan slider is part of every chart's option.
 *
 * Canvas is opaque to the DOM, so these drive real mouse gestures over the
 * chart canvas and assert the resulting state (list count / detail panel).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const rankMatch = (key: string, date: string, level: number) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', role: 'tank', hero: 'ana', result: 'victory',
    date, finished_at: '20:00', rank: 'platinum', level, rank_progress: 40, change_percent: 24,
  },
  parsed_at: `${date}T20:00:00Z`,
})

function mock(page: import('@playwright/test').Page, body: unknown) {
  return page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
}

async function openRankChart(page: import('@playwright/test').Page) {
  await page.locator('#tab-matches').click()
  await page.locator('.trends-toggle').click()
  const canvas = page.locator('.trend-card', { hasText: 'Rank over time' }).locator('canvas')
  await canvas.waitFor()
  await page.waitForTimeout(600)
  return (await canvas.boundingBox())!
}

test.describe('Matches — Trends interactions', () => {
  test('brushing a time range on a chart narrows the set', async ({ page }) => {
    // 8 matches across 8 days → brushing a middle slice drops the count.
    const corpus = Array.from({ length: 8 }, (_, i) => rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`, 3))
    await mock(page, corpus)
    await page.goto('/')
    const box = await openRankChart(page)

    const before = await page.locator('.leaf-row').count()
    expect(before).toBe(8)

    // Drag a middle sub-range (mid-height, above the bottom slider).
    const y = box.y + box.height * 0.42
    await page.mouse.move(box.x + box.width * 0.30, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.46, y)
    await page.mouse.move(box.x + box.width * 0.62, y)
    await page.mouse.up()

    await expect.poll(() => page.locator('.leaf-row').count()).toBeLessThan(before)
  })

  test('clicking a point opens that match in the detail panel', async ({ page }) => {
    // Constant level → flat line so the click reliably lands on a point.
    const corpus = Array.from({ length: 6 }, (_, i) => rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`, 3))
    await mock(page, corpus)
    await page.goto('/')
    const box = await openRankChart(page)

    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
    await page.mouse.click(box.x + box.width * 0.42, box.y + box.height * 0.46)
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })
})

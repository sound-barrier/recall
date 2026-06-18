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

const rankMatch = (key: string, date: string, level: number, role = 'tank') => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', role, hero: 'ana', result: 'victory',
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

  test('clicking the legend toggles a line, it does NOT open a match', async ({ page }) => {
    // Two roles → the legend renders; a click on it (above the plot grid)
    // must toggle the series, never open a match.
    const corpus = Array.from({ length: 6 }, (_, i) =>
      rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`, 3, i % 2 === 0 ? 'tank' : 'dps'))
    await mock(page, corpus)
    await page.goto('/')
    const box = await openRankChart(page)

    // The legend sits at the top-centre of the chart, above the grid.
    await page.mouse.click(box.x + box.width * 0.42, box.y + 18)
    await page.waitForTimeout(300)
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('a chart can be removed and added back', async ({ page }) => {
    await mock(page, Array.from({ length: 4 }, (_, i) => rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`, 3)))
    await page.goto('/')
    await openRankChart(page)

    await expect(page.locator('.trend-card')).toHaveCount(5)
    await page.locator('.trend-card', { hasText: 'Modifiers over time' }).locator('.trend-card-close').click()
    await expect(page.locator('.trend-card')).toHaveCount(4)
    const chip = page.locator('.trends-add-chip', { hasText: 'Modifiers over time' })
    await expect(chip).toBeVisible()
    await chip.click()
    await expect(page.locator('.trend-card')).toHaveCount(5)
  })

  test('Reset view clears a brushed date range', async ({ page }) => {
    await mock(page, Array.from({ length: 8 }, (_, i) => rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`, 3)))
    await page.goto('/')
    const box = await openRankChart(page)
    expect(await page.locator('.leaf-row').count()).toBe(8)

    const y = box.y + box.height * 0.42
    await page.mouse.move(box.x + box.width * 0.30, y)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.50, y)
    await page.mouse.move(box.x + box.width * 0.62, y)
    await page.mouse.up()
    await expect.poll(() => page.locator('.leaf-row').count()).toBeLessThan(8)

    await page.locator('.trends-reset').click()
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(8)
  })
})

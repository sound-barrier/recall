/**
 * Matches — Trends chart reordering.
 *
 * Each chart card carries a ⠿ grip (the only draggable element, so the
 * canvas brush stays free) backed by the shared useDragReorder. Reordering
 * works by keyboard (Arrow keys) and by native drag; the chosen order
 * persists (recall.trends.order). Native HTML5 DnD doesn't fire from
 * Playwright's mouse-based dragTo, so the drag path is driven with
 * synthetic DragEvents (mirroring dashboard-live-reflow-drag.spec.ts).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const rankMatch = (key: string, date: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', role: 'tank', hero: 'ana', result: 'victory',
    date, finished_at: '20:00', rank: 'platinum', level: 3, rank_progress: 40, change_percent: 24,
    modifiers: ['underdog', 'victory'],
  },
  parsed_at: `${date}T20:00:00Z`,
})
const CORPUS = Array.from({ length: 4 }, (_, i) => rankMatch(`m${i}`, `2026-05-${String(10 + i).padStart(2, '0')}`))

function order(page: import('@playwright/test').Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-trend-card]')).map((el) => el.getAttribute('data-trend-card') ?? ''))
}

async function openTrends(page: import('@playwright/test').Page) {
  await page.locator('#tab-matches').click()
  await page.locator('.trends-toggle').click()
  await page.locator('.trend-chart canvas').first().waitFor()
}

test.describe('Matches — Trends reorder', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
  })

  test('ArrowRight on a focused grip reorders, and the order persists', async ({ page }) => {
    await page.goto('/')
    await openTrends(page)
    expect((await order(page))[0]).toBe('rank-ladder')

    await page.locator('[data-drag-handle="rank-ladder"]').focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => order(page).then((o) => o[1])).toBe('rank-ladder')

    // Persisted: a reload keeps the new order.
    await page.reload()
    await openTrends(page)
    expect((await order(page))[1]).toBe('rank-ladder')
  })

  test('dragging a grip onto a later card moves it there', async ({ page }) => {
    await page.goto('/')
    await openTrends(page)
    expect((await order(page))[0]).toBe('rank-ladder')

    await page.evaluate(() => {
      const grip = document.querySelector('[data-drag-handle="rank-ladder"]')!
      const target = document.querySelector('[data-trend-card="rank-delta"]')!
      const dt = new DataTransfer()
      grip.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
    })

    // rank-ladder dropped in front of rank-delta (idx 2) → lands at idx 1
    // after the source splice (was idx 0, before the target).
    await expect.poll(() => order(page).then((o) => o.indexOf('rank-ladder'))).toBe(1)
  })
})

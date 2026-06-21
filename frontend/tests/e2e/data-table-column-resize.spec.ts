/**
 * Data-table column resize.
 *
 * Each column header carries a drag handle on its right edge; dragging it
 * resizes the column (a fixed-layout colgroup), and the width persists across
 * reloads. Double-click resets a column to its natural width.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, map: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map,
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

async function mapWidth(page: Page): Promise<number> {
  const box = await page.locator('.leaves-thead th[data-sort-col="map"]').boundingBox()
  return box!.width
}

async function dragHandle(page: Page, col: string, dx: number) {
  const handle = page.locator(`.leaves-thead th[data-sort-col="${col}"] .th-resize`)
  const hb = (await handle.boundingBox())!
  const y = hb.y + hb.height / 2
  await page.mouse.move(hb.x + 3, y)
  await page.mouse.down()
  await page.mouse.move(hb.x + 3 + dx, y, { steps: 6 })
  await page.mouse.up()
}

test.describe('data table — column resize', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record('m1', 'rialto'), record('m2', 'busan')]),
      }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await toDataDensity(page)
  })

  test('dragging a column handle resizes it, and the width persists', async ({ page }) => {
    const before = await mapWidth(page)
    await dragHandle(page, 'map', 60)
    const after = await mapWidth(page)
    expect(after).toBeGreaterThan(before + 40)

    // Persists across a reload.
    await page.reload()
    await page.locator('#tab-matches').click()
    await toDataDensity(page)
    expect(Math.abs((await mapWidth(page)) - after)).toBeLessThan(8)
  })

  test('double-clicking a handle resets the column to its natural width', async ({ page }) => {
    const natural = await mapWidth(page)
    await dragHandle(page, 'map', 80)
    expect(await mapWidth(page)).toBeGreaterThan(natural + 50)
    await page.locator('.leaves-thead th[data-sort-col="map"] .th-resize').dblclick()
    expect(Math.abs((await mapWidth(page)) - natural)).toBeLessThan(6)
  })
})

/**
 * Data-table cell range-select + copy.
 *
 * Drag a rectangle of cells, Ctrl/Cmd+C copies it as tab-separated text that
 * pastes into Excel/Sheets as a grid. A plain click (no drag) still opens the
 * row's detail panel.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, map: string, elims: number) {
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
      eliminations: elims,
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

async function routeMatches(page: Page, corpus: unknown[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await toDataDensity(page)
}

test.describe('data table — cell range-select + copy', () => {
  test('drag-select cells, then Ctrl+C copies them as TSV', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await routeMatches(page, [record('m1', 'rialto', 17), record('m2', 'busan', 9)])

    const start = (await page.locator('tr.table-row[data-match-key="m1"] td[data-col="1"]').boundingBox())!
    const end = (await page.locator('tr.table-row[data-match-key="m2"] td[data-col="6"]').boundingBox())!
    await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
    await page.mouse.down()
    await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 8 })
    await page.mouse.up()

    await expect(page.locator('td.is-cell-selected').first()).toBeVisible()
    // The drag did NOT open the detail panel.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)

    await page.keyboard.press('ControlOrMeta+c')
    const clip = await page.evaluate(() => navigator.clipboard.readText())
    expect(clip).toContain('rialto')
    expect(clip).toContain('busan')
    expect(clip).toContain('\t')
    expect(clip.split('\n')).toHaveLength(2) // two selected rows
  })

  test('a plain click (no drag) still opens the detail panel', async ({ page }) => {
    await routeMatches(page, [record('m1', 'rialto', 17)])
    await page.locator('tr.table-row[data-match-key="m1"] td[data-col="0"]').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })
})

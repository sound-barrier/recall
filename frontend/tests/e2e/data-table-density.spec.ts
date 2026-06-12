/**
 * Data-density table E2E.
 *
 * The `data` row density renders the matches list as a real <table>:
 * sortable column headers (sorting rows WITHIN each Y/M/W/D group), full
 * leaf-row interaction parity (a row click opens the detail panel), and
 * the scoped-search highlight (F1) inside cells. The default grouping is
 * by day, so a single-day corpus lands in one group where the
 * within-group column sort is observable.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Opts {
  map: string
  hero: string
  result?: 'victory' | 'defeat' | 'draw'
  elims?: number
  tags?: string[]
}

function record(key: string, o: Opts) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: o.map,
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: o.hero,
      result: o.result ?? 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: o.elims ?? 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero: o.hero, percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(o.tags ? { annotation: { tags: o.tags } } : {}),
  }
}

// One day → one group, distinct maps/heroes/elims so each column sorts
// to a distinct order.
const CORPUS = [
  record('m-rialto', { map: 'rialto', hero: 'lucio', result: 'victory', elims: 20 }),
  record('m-busan', { map: 'busan', hero: 'mercy', result: 'defeat', elims: 10 }),
  record('m-ilios', { map: 'ilios', hero: 'ana', result: 'victory', elims: 30, tags: ['clutch'] }),
]

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

function rowKeys(page: Page) {
  return page
    .locator('tr.table-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}

test.describe('data density — sortable grouped table', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)
  })

  test('Data density renders a column-header <table>', async ({ page }) => {
    await toDataDensity(page)
    await expect(page.locator('table.leaves-table thead')).toBeVisible()
    await expect(page.locator('th[data-sort-col="map"]')).toBeVisible()
    await expect(page.locator('th[data-sort-col="hero"]')).toBeVisible()
    await expect(page.locator('tr.table-row')).toHaveCount(3)
  })

  test('clicking a column header sorts rows within the group, toggling direction', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="map"]').click()
    expect(await rowKeys(page)).toEqual(['m-busan', 'm-ilios', 'm-rialto']) // ascending
    await page.locator('th[data-sort-col="map"]').click()
    expect(await rowKeys(page)).toEqual(['m-rialto', 'm-ilios', 'm-busan']) // descending
  })

  test('sorting by a numeric column (eliminations) orders numerically', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="eliminations"]').click()
    expect(await rowKeys(page)).toEqual(['m-busan', 'm-rialto', 'm-ilios']) // 10 < 20 < 30
  })

  test('a row click opens the detail panel (interaction parity)', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('tr.table-row[data-match-key="m-rialto"] .tc-hero').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('the scoped-search highlight (F1) renders inside cells', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('#np-search').fill('busan')
    await page.locator('.np-close').click()
    await expect(
      page.locator('tr.table-row[data-match-key="m-busan"] mark.search-hl'),
    ).toHaveText('busan')
  })
})

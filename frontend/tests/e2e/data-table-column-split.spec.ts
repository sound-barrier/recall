/**
 * Split-column data table E2E.
 *
 * The data-density table used to cram play-mode + queue into one "Mode"
 * cell and E/A/D into one slash-joined cell. They're now five separate,
 * independently sortable columns (Mode, Queue, E, A, D). This proves the
 * new headers sort the whole table and the cells render distinctly —
 * through the real api.ts ↔ /api/v1/matches ↔ render chain.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Opts {
  assists?: number
  deaths?: number
  queueType?: 'role' | 'open'
  playMode?: 'competitive' | 'quickplay'
}

function record(key: string, o: Opts = {}) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 15,
      assists: o.assists ?? 10,
      deaths: o.deaths ?? 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
    ...(o.queueType ? { queue_type: o.queueType } : {}),
    ...(o.playMode ? { play_mode: o.playMode } : {}),
  }
}

const CORPUS = [
  record('m-a', { assists: 5, deaths: 9, queueType: 'role' }),
  record('m-b', { assists: 20, deaths: 2, queueType: 'open' }),
  record('m-c', { assists: 12, deaths: 15 }), // no queue → "Unknown mode type"
]

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

function rowKeys(page: Page) {
  return page.locator('tr.table-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
})

test('Mode and Queue are separate, independently present columns', async ({ page }) => {
  await toDataDensity(page)
  await expect(page.locator('th[data-sort-col="playMode"]')).toBeVisible()
  await expect(page.locator('th[data-sort-col="queue"]')).toBeVisible()
  // Each row carries a distinct Mode cell and Queue cell.
  const row = page.locator('tr.table-row[data-match-key="m-a"]')
  await expect(row.locator('.tc-mode')).toHaveCount(1)
  await expect(row.locator('.tc-queue')).toContainText('Role Queue')
})

test('E / A / D render as three separate cells (no slash-joined stats)', async ({ page }) => {
  await toDataDensity(page)
  const row = page.locator('tr.table-row[data-match-key="m-a"]')
  await expect(row.locator('.tc-elim')).toHaveText('15')
  await expect(row.locator('.tc-assist')).toHaveText('5')
  await expect(row.locator('.tc-death')).toHaveText('9')
  await expect(page.locator('.tc-stats')).toHaveCount(0)
})

test('the Assists column sorts the whole table on its own key', async ({ page }) => {
  await toDataDensity(page)
  await page.locator('th[data-sort-col="assists"]').click() // ascending: 5 < 12 < 20
  expect(await rowKeys(page)).toEqual(['m-a', 'm-c', 'm-b'])
})

test('the Deaths column sorts independently of eliminations', async ({ page }) => {
  await toDataDensity(page)
  await page.locator('th[data-sort-col="deaths"]').click() // ascending: 2 < 9 < 15
  expect(await rowKeys(page)).toEqual(['m-b', 'm-a', 'm-c'])
})

test('the Queue column sorts by its effective label', async ({ page }) => {
  await toDataDensity(page)
  await page.locator('th[data-sort-col="queue"]').click() // Open < Role < Unknown
  expect(await rowKeys(page)).toEqual(['m-b', 'm-a', 'm-c'])
})

/**
 * Value-click filtering (cozy/compact + data).
 *
 * Every value cell — hero, role, map, mode, queue, result — filters the set on
 * click (sorting is the column headers / sort toolbar's job, not a click). The
 * clicked value's cells light up as the active filter.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, hero: string, role: string, playlist: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist,
      game_mode: 'control',
      role,
      hero,
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero, percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const CORPUS = [
  record('m1', 'lucio', 'support', 'competitive'),
  record('m2', 'ana', 'tank', 'quickplay'),
]

async function mount(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(2)
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

test.describe('value-click filtering', () => {
  test('cozy: clicking a hero chip filters by that hero and lights it up', async ({ page }) => {
    await mount(page)
    await page.locator('.leaf-row[data-match-key="m1"] .leaf-hero-chip', { hasText: 'lucio' }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row[data-match-key="m1"]')).toHaveCount(1)
    await expect(page.locator('.leaf-hero-chip.is-filtered')).toHaveText('lucio')
    // The chip click did not open the detail panel.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('cozy: clicking a role chip filters by that role', async ({ page }) => {
    await mount(page)
    await page.locator('.leaf-row[data-match-key="m1"] .leaf-role-chip', { hasText: 'support' }).click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row[data-match-key="m1"]')).toHaveCount(1)
  })

  test('data table: clicking a hero chip filters + lights up; mode cell filters too', async ({ page }) => {
    await mount(page)
    await toDataDensity(page)
    await page.locator('tr.table-row[data-match-key="m1"] .tc-hero-chip', { hasText: 'lucio' }).click()
    await expect(page.locator('tr.table-row')).toHaveCount(1)
    await expect(page.locator('.tc-hero-chip.is-filtered')).toHaveText('lucio')
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('data table: clicking the Mode cell filters by play mode', async ({ page }) => {
    await mount(page)
    await toDataDensity(page)
    // m1 competitive, m2 quickplay → filter to competitive leaves m1.
    await page.locator('tr.table-row[data-match-key="m1"] .tc-mode .tc-filter-cell').click()
    await expect(page.locator('tr.table-row')).toHaveCount(1)
    await expect(page.locator('tr.table-row[data-match-key="m1"]')).toHaveCount(1)
  })
})

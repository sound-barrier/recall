/**
 * Flat ⇄ Pivot toggle E2E.
 *
 * The data-density surface gains a Flat/Pivot segmented control. Flat is
 * the sortable table; Pivot swaps it for the crosstab builder over the
 * same set. The choice persists across reloads.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, hero: string, result: 'victory' | 'defeat') {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support',
      hero, result, date: '2026-05-10', finished_at: '22:00',
      eliminations: 15, assists: 10, deaths: 8,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const CORPUS = [
  record('m-1', 'ana', 'victory'),
  record('m-2', 'ana', 'defeat'),
  record('m-3', 'kiriko', 'victory'),
]

async function mountInDataDensity(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

test('flipping to Pivot swaps the flat table for the crosstab', async ({ page }) => {
  await mountInDataDensity(page)
  await expect(page.locator('[data-testid="pivot-table"]')).toBeHidden()

  await page.locator('[data-table-mode-pick="pivot"]').click()
  await expect(page.locator('[data-testid="pivot-table"]')).toBeVisible()
  await expect(page.locator('.pivot-crosstab')).toBeVisible()
  await expect(page.locator('table.leaves-table')).toBeHidden()

  // The default hero × result pivot renders a row per hero.
  await expect(page.locator('.ct-rowhead', { hasText: 'ana' })).toBeVisible()
  await expect(page.locator('.ct-rowhead', { hasText: 'kiriko' })).toBeVisible()
})

test('flipping back to Flat restores the sortable table', async ({ page }) => {
  await mountInDataDensity(page)
  await page.locator('[data-table-mode-pick="pivot"]').click()
  await expect(page.locator('.pivot-crosstab')).toBeVisible()
  await page.locator('[data-table-mode-pick="flat"]').click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
  await expect(page.locator('[data-testid="pivot-table"]')).toBeHidden()
})

test('the Pivot choice persists across a reload', async ({ page }) => {
  await mountInDataDensity(page)
  await page.locator('[data-table-mode-pick="pivot"]').click()
  await expect(page.locator('[data-testid="pivot-table"]')).toBeVisible()

  await page.reload()
  // Matches is the default landing tab; density + mode are persisted.
  await expect(page.locator('[data-testid="pivot-table"]')).toBeVisible()
  await expect(page.locator('.pivot-crosstab')).toBeVisible()
})

/**
 * Pivot field-shelf interaction E2E.
 *
 * Fields move between the tray and the Rows / Columns / Values / Filters
 * shelves two ways: native drag-and-drop (mouse) and a keyboard-operable
 * menu on each chip (the a11y-primary path, since HTML5 DnD isn't
 * keyboard-operable). Both must re-pivot the crosstab.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, hero: string, map: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map, playlist: 'competitive', game_mode: 'control', role: 'support',
      hero, result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 15, assists: 10, deaths: 8,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const CORPUS = [
  record('m-1', 'ana', 'rialto'),
  record('m-2', 'kiriko', 'busan'),
  record('m-3', 'ana', 'busan'),
]

async function mountPivot(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await page.locator('[data-table-mode-pick="pivot"]').click()
  await expect(page.locator('[data-testid="pivot-table"]')).toBeVisible()
}

test('the keyboard menu adds a tray field to a shelf and re-pivots', async ({ page }) => {
  await mountPivot(page)
  // Map starts in the tray (default rows=hero, columns=result).
  const trayMap = page.locator('[data-pivot-zone="tray"] [data-pivot-chip="map"]')
  await expect(trayMap).toBeVisible()

  await trayMap.focus()
  await trayMap.press('Enter') // opens the chip menu
  await page.locator('button[role="menuitem"]', { hasText: 'Add to Rows' }).click()

  // Map now lives on the Rows shelf and the crosstab gained a map axis.
  await expect(page.locator('[data-pivot-zone="rows"] [data-pivot-chip="map"]')).toBeVisible()
  await expect(trayMap).toHaveCount(0)
  await expect(page.locator('.ct-rowhead', { hasText: 'rialto' })).toBeVisible()
})

test('dragging a tray field onto a shelf re-pivots', async ({ page }) => {
  await mountPivot(page)
  const trayGameMode = page.locator('[data-pivot-zone="tray"] [data-pivot-chip="gameMode"]')
  await trayGameMode.dragTo(page.locator('[data-pivot-zone="columns"]'))
  await expect(page.locator('[data-pivot-zone="columns"] [data-pivot-chip="gameMode"]')).toBeVisible()
})

test('the chip menu removes a placed field from its shelf', async ({ page }) => {
  await mountPivot(page)
  const rowsHero = page.locator('[data-pivot-zone="rows"] [data-pivot-chip="hero"]')
  await expect(rowsHero).toBeVisible()
  await rowsHero.click() // open menu
  await page.locator('button[role="menuitem"]', { hasText: 'Remove' }).first().click()
  await expect(page.locator('[data-pivot-zone="rows"] [data-pivot-chip="hero"]')).toHaveCount(0)
  // Removed dimensions return to the tray.
  await expect(page.locator('[data-pivot-zone="tray"] [data-pivot-chip="hero"]')).toBeVisible()
})

test('a Filters-shelf value checklist slices the crosstab', async ({ page }) => {
  await mountPivot(page)
  await page.locator('[data-pivot-zone="tray"] [data-pivot-chip="map"]').dragTo(page.locator('[data-pivot-zone="filters"]'))
  const filterChip = page.locator('[data-pivot-zone="filters"] [data-pivot-chip="map"]')
  await expect(filterChip).toBeVisible()

  await filterChip.click() // open the menu → value checklist
  const checks = page.locator('[role="menuitemcheckbox"]')
  await expect(checks).toHaveCount(2) // rialto + busan, both included by default
  await expect(page.locator('.pivot-count')).toContainText('3 matches')
  await expect(page.locator('.pivot-chip-menu-head')).toContainText('2 of 2 shown')

  // Uncheck busan: the tick must visually flip (the reported bug was a
  // stuck checkbox), the label strikes through so exclusion is obvious,
  // the "N of M shown" counter ticks down, and only the rialto match
  // (m-1) survives the filter.
  const busan = page.locator('[role="menuitemcheckbox"]', { hasText: 'busan' })
  await expect(busan).toHaveAttribute('aria-checked', 'true')
  await busan.click()
  await expect(busan).toHaveAttribute('aria-checked', 'false')
  await expect(busan.locator('.pivot-chip-cklabel')).toHaveCSS('text-decoration-line', 'line-through')
  await expect(page.locator('.pivot-chip-menu-head')).toContainText('1 of 2 shown')
  await expect(page.locator('.pivot-count')).toContainText('1 match')

  // The "All" reset re-includes every value (Excel-style include-by-default).
  await page.locator('.pivot-chip-reset').click()
  await expect(busan).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.pivot-count')).toContainText('3 matches')
})

test('changing a value aggregation re-folds the crosstab', async ({ page }) => {
  await mountPivot(page)
  // The Values shelf shows Matches (count) + Matches (Win rate). Open the
  // first value chip's menu and switch its aggregation to Win rate.
  const valueChip = page.locator('[data-pivot-zone="values"] [data-pivot-chip="matches"]').first()
  await valueChip.click()
  await page.locator('button[role="menuitem"]', { hasText: 'Win rate' }).first().click()
  // A win-rate cell reads as a percentage somewhere in the crosstab.
  await expect(page.locator('.pivot-crosstab')).toContainText('%')
})

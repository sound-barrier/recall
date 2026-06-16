/**
 * Pivot filter checklist — WebKit (WKWebView) regression.
 *
 * The desktop app renders in macOS WKWebView, where a <button> is NOT
 * focused on click (a long-standing Safari behaviour). The filter menu's
 * focusout-based dismissal collided with that: clicking a value's checkbox
 * blurred the menu, closed it mid-click, and the toggle was lost — the box
 * "wouldn't uncheck." This guards the toggle in the same engine the desktop
 * app uses. Chromium can't reproduce it, hence the `-webkit` suffix.
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

async function mountPivotWithMapFilter(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await page.locator('[data-table-mode-pick="pivot"]').click()
  await expect(page.locator('[data-testid="pivot-table"]')).toBeVisible()

  // Add Map to Filters via the keyboard menu (DnD is flaky cross-engine).
  await page.locator('[data-pivot-zone="tray"] [data-pivot-chip="map"]').click()
  await page.locator('button[role="menuitem"]', { hasText: 'Add to Filters' }).click()
  await expect(page.locator('[data-pivot-zone="filters"] [data-pivot-chip="map"]')).toBeVisible()
}

test('a filter value unchecks on click in WebKit (menu stays open)', async ({ page }) => {
  await mountPivotWithMapFilter(page)

  await page.locator('[data-pivot-zone="filters"] [data-pivot-chip="map"]').click()
  const busan = page.locator('[role="menuitemcheckbox"]', { hasText: 'busan' })
  await expect(busan).toHaveAttribute('aria-checked', 'true')

  await busan.click()
  // The bug: the click was swallowed and the box never unchecked.
  await expect(busan).toHaveAttribute('aria-checked', 'false')
  // The menu must NOT have closed out from under the click.
  await expect(page.locator('.pivot-chip-menu')).toBeVisible()
  await expect(page.locator('.pivot-count')).toContainText('1 match')

  // The menu stayed open, so a second click toggles without re-opening
  // (the original bug closed the menu after the first interaction).
  await busan.click()
  await expect(busan).toHaveAttribute('aria-checked', 'true')
  await expect(page.locator('.pivot-count')).toContainText('3 matches')
})

/**
 * Persistent NarrowRail at ≥1400 px viewport.
 *
 * At the wide viewport the "Narrow this set" panel renders as a
 * peer column on the left of the matches workspace — always
 * visible, no trigger button, no modal chrome, no focus trap. At
 * narrower viewports the historical popover mode stays: trigger
 * button + teleport'd modal with focus trap.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function makeMatches(): Record<string, unknown>[] {
  return Array.from({ length: 6 }, (_, i) => ({
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      finished_at: '22:00',
      eliminations: 10, assists: 5, deaths: 3,
    },
    parsed_at: `2026-05-${String(i + 1).padStart(2, '0')}T22:30:00Z`,
  }))
}

test.describe('Matches — narrow rail vs popover by viewport', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(makeMatches()),
      })
    })
  })

  test('rail mode renders the panel inline at ≥1400 px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // The panel is always visible in rail mode — no trigger needed.
    await expect(page.locator('.matches-set-workspace-rail')).toBeVisible()
    await expect(page.locator('.left-panel-rail')).toBeVisible()
    // Trigger button is hidden in rail mode.
    await expect(page.locator('[data-narrow-trigger]')).toHaveCount(0)
    // Inputs inside the panel are interactive without a focus trap.
    const search = page.locator('input[type="search"][placeholder*="map · hero"]').first()
    await expect(search).toBeVisible()
    await search.fill('rialto')
    // Narrowing still drives the leaves list.
    await expect(page.locator('.dossier-meta')).toContainText(/6 of 6/i)
  })

  test('popover mode still works at narrower viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // No rail at narrow viewport — the trigger button + modal
    // contract returns.
    await expect(page.locator('.left-panel-rail')).toHaveCount(0)
    await expect(page.locator('[data-narrow-trigger]')).toBeVisible()
    // Panel is hidden until trigger click.
    await expect(page.locator('.left-panel')).toHaveCount(0)
    await page.locator('[data-narrow-trigger]').click()
    await expect(page.locator('.left-panel')).toBeVisible()
  })
})

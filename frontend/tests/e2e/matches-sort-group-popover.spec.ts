/**
 * Combined Sort + Group dropdown on the Matches leaves head.
 *
 * Trigger button shows the current "Sort · Group" label (e.g.
 * "Newest · by day"). Click → popover opens with two radio
 * groups (Sort and Group). Picking a radio updates the leaves
 * list immediately + leaves the popover open so the user can
 * tweak the other axis without re-opening. Esc / click-outside
 * close the popover.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function makeMatches(): Record<string, unknown>[] {
  return Array.from({ length: 8 }, (_, i) => ({
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
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

test.describe('Matches — Sort + Group dropdown', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(makeMatches()),
      })
    })
  })

  test('trigger shows the current Sort · Group label', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    const trigger = page.locator('[data-sort-group-trigger]')
    await expect(trigger).toBeVisible()
    // Defaults: Newest · by day.
    await expect(trigger).toContainText(/Newest/i)
    await expect(trigger).toContainText(/by day/i)
  })

  test('clicking the trigger opens the popover with two radio groups', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    const popover = page.getByTestId('sort-group-popover')
    await expect(popover).toHaveCount(0)
    await page.locator('[data-sort-group-trigger]').click()
    await expect(popover).toBeVisible()
    // Both fieldsets render.
    await expect(popover.locator('legend')).toHaveCount(2)
    // Currently-picked rows reflect defaults.
    await expect(popover.locator('[data-sort-pick="newest"]')).toBeChecked()
    await expect(popover.locator('[data-group-pick="day"]')).toBeChecked()
  })

  test('picking Oldest updates the trigger label and the leaves order', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const trigger = page.locator('[data-sort-group-trigger]')
    const firstDate = await page.locator('.leaf-row').first().textContent()

    await trigger.click()
    await page.locator('[data-sort-pick="oldest"]').click()

    await expect(trigger).toContainText(/Oldest/i)
    const newFirstDate = await page.locator('.leaf-row').first().textContent()
    expect(newFirstDate).not.toBe(firstDate)
  })

  test('clicking outside closes the popover', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-sort-group-trigger]').click()
    await expect(page.getByTestId('sort-group-popover')).toBeVisible()

    // Click well outside the popover.
    await page.mouse.click(20, 20)
    await expect(page.getByTestId('sort-group-popover')).toHaveCount(0)
  })
})

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
    const newFirstDate = page.locator('.leaf-row').first()
    await expect(newFirstDate).not.toHaveText(firstDate)
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

  test('grouping by provenance buckets the list into Edited / User entered / OCR', async ({ page }) => {
    function provRecord(key: string, source?: string) {
      return {
        match_key: key,
        source_files: [`${key}.png`],
        source_types: { [`${key}.png`]: 'summary' },
        data: { map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00', eliminations: 10, assists: 5, deaths: 3 },
        parsed_at: '2026-05-10T22:30:00Z',
        ...(source ? { source, ...(source === 'ocr_edited' ? { edited_fields: ['data.map'] } : {}) } : {}),
      }
    }
    const mixed = [provRecord('p-ocr'), provRecord('p-edited', 'ocr_edited'), provRecord('p-manual', 'manual')]
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mixed) }),
    )

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-group-pick="provenance"]').click()

    // Three dividers, user-touched first, in the surfacing order.
    await expect(page.locator('.section-divider .sd-label')).toHaveText(['Edited', 'User entered', 'OCR generated'])
    // The trigger label reflects the new grouping.
    await expect(page.locator('[data-sort-group-trigger]')).toContainText(/by provenance/i)
  })

  test('a grouped section collapses to its header and re-expands', async ({ page }) => {
    function provRecord(key: string, source?: string) {
      return {
        match_key: key,
        source_files: [`${key}.png`],
        source_types: { [`${key}.png`]: 'summary' },
        data: { map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00', eliminations: 10, assists: 5, deaths: 3 },
        parsed_at: '2026-05-10T22:30:00Z',
        ...(source ? { source } : {}),
      }
    }
    const mixed = [provRecord('man-1', 'manual'), provRecord('man-2', 'manual'), provRecord('ocr-1')]
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(mixed) }),
    )

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-group-pick="provenance"]').click()
    await page.keyboard.press('Escape') // dismiss the popover to reach the list

    await expect(page.locator('.leaf-row')).toHaveCount(3)
    const userToggle = page.locator('[data-section-toggle="manual"]')
    await expect(userToggle).toHaveAttribute('aria-expanded', 'true')

    // Collapse "User entered" → its two rows hide, the header stays, the
    // OCR row is untouched.
    await userToggle.click()
    await expect(userToggle).toHaveAttribute('aria-expanded', 'false')
    await expect(userToggle.locator('.sd-label')).toHaveText('User entered')
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // Re-expand restores them.
    await userToggle.click()
    await expect(userToggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.leaf-row')).toHaveCount(3)
  })
})

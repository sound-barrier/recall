/**
 * Direct-manipulation dashboard edit mode:
 *   - Edit checkbox in the dossier header flips edit mode.
 *   - Click a widget → it lights up + a trash button appears.
 *   - Trash button removes the widget from the dossier (and the
 *     persisted layout) without going through the modal.
 *   - "+" tile at the row tail opens the customizer; the customizer
 *     surfaces only widgets NOT currently in the layout, each with a
 *     "+ Add" button that puts the widget back.
 *   - Reset layout button restores the install default.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('dashboard edit mode — direct manipulation', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
  })

  test('tick Edit → click widget → click trash → widget gone; reload persists', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Winrate is in the install default.
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()

    // No trash button appears outside edit mode.
    await expect(page.locator('[data-widget-remove="winrate"]')).toHaveCount(0)

    // Flip Edit.
    await page.locator('input[data-edit-toggle]').check()

    // Click the widget body to select it.
    await page.locator('[data-widget-id="winrate"]').click({ position: { x: 5, y: 60 } })

    // Trash now appears on the selected widget.
    const trash = page.locator('[data-widget-remove="winrate"]')
    await expect(trash).toBeVisible()

    // Click trash → widget gone.
    await trash.click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Reload — still gone (layout persists without winrate).
    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)
  })

  test('"+" tile opens the customizer; + Add brings the widget back', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Trash winrate first so it's addable.
    await page.locator('input[data-edit-toggle]').check()
    await page.locator('[data-widget-id="winrate"]').click({ position: { x: 5, y: 60 } })
    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // The "+" tile is present at the tail of the last row.
    await page.locator('button[data-add-tile]').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()

    // The customizer lists winrate as addable.
    const addBtn = page.locator('button[data-widget-add="winrate"]')
    await expect(addBtn).toBeVisible()

    // + Add → winrate returns.
    await addBtn.click()
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()

    // After adding, the add button disappears (now in layout).
    await expect(addBtn).toHaveCount(0)
  })

  test('Reset layout restores the install default', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Trash winrate.
    await page.locator('input[data-edit-toggle]').check()
    await page.locator('[data-widget-id="winrate"]').click({ position: { x: 5, y: 60 } })
    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Open customizer, hit Reset.
    await page.locator('button[data-add-tile]').click()
    await page.locator('button[data-reset-layout]').click()

    // Close modal.
    await page.locator('.dashboard-customizer-btn-primary').click()

    // Winrate returns.
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })

  test('Esc closes the modal without disturbing the page', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()
    await page.locator('button[data-add-tile]').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.dashboard-customizer-box')).toHaveCount(0)
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })
})

/**
 * Phase 2 — hide / show dashboard widgets via the "Edit dashboard"
 * modal.
 *
 * Drives the round-trip: open modal → untick a widget → close →
 * widget gone → reload → still gone → Reset → returns.
 *
 * The widget under test is `winrate` because it's always the first
 * KPI tile in the default layout and renders unconditionally
 * regardless of the corpus (a single-record corpus still emits a
 * winrate or em-dash).
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

test.describe('dashboard customizer — hide / show widgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
  })

  test('untick a widget in the modal → widget vanishes; persists across reload; Reset restores', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Winrate widget is visible by default.
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()

    // Open the customizer.
    await page.locator('[data-edit-dashboard]').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()

    // Untick the Winrate toggle. uncheck() exists on Locator; using
    // it also fires the @change handler the SFC wires.
    await page.locator('input[data-widget-toggle="winrate"]').uncheck()

    // Close the modal.
    await page.locator('.dashboard-customizer-btn-primary').click()
    await expect(page.locator('.dashboard-customizer-box')).toHaveCount(0)

    // The widget is gone from the dossier.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Persistence: reload and assert it stays gone.
    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Reset via the modal.
    await page.locator('[data-edit-dashboard]').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()
    await page.locator('.dashboard-customizer-btn-ghost').click()
    await page.locator('.dashboard-customizer-btn-primary').click()

    // Winrate returns.
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })

  test('Esc closes the modal without disturbing the page', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-edit-dashboard]').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.dashboard-customizer-box')).toHaveCount(0)
    // The dossier is still rendered after the modal closes.
    await expect(page.locator('[data-widget-id="winrate"]')).toBeVisible()
  })

  test('hiding every widget in a row surfaces the empty-state hint', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('[data-edit-dashboard]').click()

    // Untick every breakdown so row 2 ends up empty. Three
    // breakdowns: top-maps, top-heroes, top-roles.
    await page.locator('input[data-widget-toggle="top-maps"]').uncheck()
    await page.locator('input[data-widget-toggle="top-heroes"]').uncheck()
    await page.locator('input[data-widget-toggle="top-roles"]').uncheck()

    await page.locator('.dashboard-customizer-btn-primary').click()

    // Empty-state placeholder renders in row 2.
    const placeholder = page.locator('.dashboard-row-empty[data-row="2"]')
    await expect(placeholder).toBeVisible()
    await expect(placeholder).toContainText('Every widget in this row is hidden')

    // The inline "open Edit dashboard" link re-opens the customizer.
    await placeholder.locator('button.dashboard-row-empty-link').click()
    await expect(page.locator('.dashboard-customizer-box')).toBeVisible()
  })
})

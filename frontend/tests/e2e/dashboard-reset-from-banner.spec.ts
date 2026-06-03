/**
 * Resetting the dashboard from the edit banner.
 *
 * Reset used to be one level deep — Edit → click the "+" tile →
 * customizer modal opens → "Reset layout" button in the footer. The
 * edit banner is the natural place to surface this since the user is
 * already in "I want to change my dashboard" mode. The banner button
 * uses a two-step inline confirm so an accidental click doesn't wipe
 * customizations.
 *
 * Contracts:
 *   1. Edit-banner Reset is present and visible in edit mode.
 *   2. First click arms confirm; layout is unchanged.
 *   3. Second click commits the reset; localStorage layout reverts
 *      to the install default; trashed widgets reappear.
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

test.describe('dashboard reset — from edit banner', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()
  })

  test('Reset button is present in the edit banner', async ({ page }) => {
    const reset = page.locator('[data-edit-banner-reset]')
    await expect(reset).toBeVisible()
    await expect(reset).toHaveText(/^reset$/i)
  })

  test('first click arms confirm; layout unchanged; second click commits', async ({ page }) => {
    // Trash a widget so the post-reset state is observably different.
    await page.locator('button[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // First click — arms confirm.
    const reset = page.locator('[data-edit-banner-reset]')
    await reset.click()
    await expect(reset).toHaveText(/confirm/i)
    // Layout is still the trashed-Winrate state.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Second click — commits the reset.
    await reset.click()
    // Winrate is back.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(1)
    // Button returned to idle copy.
    await expect(reset).toHaveText(/^reset$/i)

    // Persisted layout in localStorage now matches the install default
    // for row 1 (winrate is the first entry).
    const stored = await page.evaluate(() => localStorage.getItem('recall.dashboard.layout'))
    expect(stored).not.toBeNull()
    const parsed = JSON.parse(stored!) as Record<string, string[]>
    expect(parsed['1']?.[0]).toBe('winrate')
  })
})

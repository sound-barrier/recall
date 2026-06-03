/**
 * Edit-UX polish PR — pill toggle, status banner, hover-revealed
 * controls, undo toast after trash.
 *
 * These are pure UX additions over the direct-manipulation edit
 * model PR A landed; the underlying layout / drag / customizer
 * contracts are unchanged and exercised by the dashboard-edit-mode
 * + dashboard-drag-reorder specs.
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

test.describe('dashboard edit-UX polish', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
  })

  test('Edit pill toggle flips state when clicked; banner appears when ON', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // No banner in VIEW mode.
    await expect(page.locator('.dashboard-edit-banner')).toHaveCount(0)

    // Tick Edit via the pill toggle's hidden input.
    await page.locator('input[data-edit-toggle]').check()

    // Banner appears with the status text + the Done button.
    await expect(page.locator('.dashboard-edit-banner')).toBeVisible()
    await expect(page.locator('.dashboard-edit-banner-label')).toContainText(/editing/i)
    await expect(page.locator('[data-edit-banner-exit]')).toBeVisible()

    // The pill switch wrapper carries `is-on`.
    await expect(page.locator('.dossier-edit-switch.is-on')).toBeVisible()
  })

  test('Done button in the banner exits edit mode', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()
    await expect(page.locator('.dashboard-edit-banner')).toBeVisible()

    await page.locator('[data-edit-banner-exit]').click()
    await expect(page.locator('.dashboard-edit-banner')).toHaveCount(0)
    // And the pill no longer wears `is-on`.
    await expect(page.locator('.dossier-edit-switch.is-on')).toHaveCount(0)
  })

  test('trash icon is present on every widget in edit mode (not just selected)', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()

    // Trash buttons exist on EVERY rendered widget — no need to
    // click-select first. The PR A model gated trash to the
    // selected widget; the polish PR moves it to always-present so
    // remove is one click.
    const trashCount = await page.locator('button[data-widget-remove]').count()
    expect(trashCount).toBeGreaterThan(0)
    const widgetCount = await page.locator('[data-widget-id]').count()
    expect(trashCount).toBe(widgetCount)
  })

  test('trash → undo toast appears with widget name, Undo button restores it', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()

    // Confirm Winrate is in the dossier.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(1)

    // Trash it.
    await page.locator('button[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    // Undo toast appears with the widget eyebrow.
    const toast = page.locator('[data-undo-toast]')
    await expect(toast).toBeVisible()
    await expect(toast.locator('.dashboard-undo-toast-name')).toContainText('Winrate')

    // Click Undo → widget comes back.
    await toast.locator('[data-undo-action]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(1)
    // Toast goes away.
    await expect(page.locator('[data-undo-toast]')).toHaveCount(0)
  })

  test('undo toast dismiss × closes it without restoring the widget', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[data-edit-toggle]').check()

    await page.locator('button[data-widget-remove="winrate"]').click()
    const toast = page.locator('[data-undo-toast]')
    await expect(toast).toBeVisible()

    await toast.locator('[data-undo-dismiss]').click()
    await expect(toast).toHaveCount(0)
    // Widget stays removed.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)
  })
})

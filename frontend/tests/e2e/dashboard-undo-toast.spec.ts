/**
 * Remove → undo toast. Trashing a widget pops a toast naming it with
 * an Undo (restore at the original spot) and a dismiss ×. No edit mode
 * — the trash is always one click away.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

const RECENT = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: RECENT, finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${RECENT}T22:30:00Z`,
  }
}

test.describe('dashboard widget remove → undo toast', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([singleMatch()]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('trash → undo toast appears with widget name; Undo restores it', async ({ page }) => {
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(1)

    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    const toast = page.locator('[data-undo-toast]')
    await expect(toast).toBeVisible()
    await expect(toast.locator('.dashboard-undo-toast-name')).toContainText('Winrate')

    await toast.locator('[data-undo-action]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(1)
    await expect(page.locator('[data-undo-toast]')).toHaveCount(0)
  })

  test('undo toast dismiss × closes it without restoring the widget', async ({ page }) => {
    await page.locator('[data-widget-remove="winrate"]').click()
    const toast = page.locator('[data-undo-toast]')
    await expect(toast).toBeVisible()

    await toast.locator('[data-undo-dismiss]').click()
    await expect(toast).toHaveCount(0)
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)
  })
})

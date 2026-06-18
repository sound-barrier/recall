/**
 * Matches — modifier dossier widgets (opt-in).
 *
 * The "Match modifiers" breakdown + the Uphill Battles / Reversals KPI
 * tiles surface the OW2 rank-update modifier pills parsed from competitive
 * screenshots. They're opt-in (added via the dossier catalog). This proves
 * the full chain: api.ts → /api/* → Go handler → aggregator → render, with
 * the corrected modifier vocabulary.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (i: number, result: string, modifiers: string[]) => ({
  match_key: `k${i}`,
  source_files: [`k${i}.png`],
  source_types: { [`k${i}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', role: 'tank', hero: 'ana', result,
    date: `2026-05-${String(10 + i).padStart(2, '0')}`, finished_at: '20:00',
    rank: 'platinum', level: 3, rank_progress: 40, change_percent: result === 'victory' ? 22 : -18,
    modifiers,
  },
  parsed_at: `2026-05-${String(10 + i).padStart(2, '0')}T20:00:00Z`,
})

const CORPUS = [
  match(0, 'victory', ['uphill battle', 'victory']),
  match(1, 'victory', ['uphill battle', 'victory']),
  match(2, 'victory', ['uphill battle', 'victory']),
  match(3, 'defeat', ['reversal', 'defeat']),
  match(4, 'defeat', ['reversal', 'defeat']),
  match(5, 'victory', ['calibration', 'win streak', 'victory']),
]

test.describe('Matches — modifier widgets', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
    await page.locator('[data-dossier-add]').click()
    for (const id of ['uphill-battle', 'reversal', 'modifier-breakdown']) {
      await page.locator(`[data-widget-add="${id}"]`).click()
    }
    await page.keyboard.press('Escape')
  })

  test('the breakdown counts each non-result modifier with its win-rate', async ({ page }) => {
    const widget = page.locator('[data-widget-id="modifier-breakdown"]')
    await expect(widget).toBeVisible()
    const uphill = widget.locator('li', { hasText: 'uphill battle' })
    await expect(uphill).toContainText('3x')
    await expect(uphill).toContainText('100%')
    const reversal = widget.locator('li', { hasText: 'reversal' })
    await expect(reversal).toContainText('2x')
    await expect(reversal).toContainText('0%')
    // win streak / calibration are surfaced too.
    await expect(widget.locator('li', { hasText: 'win streak' })).toBeVisible()
  })

  test('the Uphill Battles + Reversals KPIs read the right counts', async ({ page }) => {
    const uphill = page.locator('[data-widget-id="uphill-battle"]')
    await expect(uphill.locator('.kpi-value')).toHaveText('3')
    await expect(uphill).toContainText('underdog')

    const reversal = page.locator('[data-widget-id="reversal"]')
    await expect(reversal.locator('.kpi-value')).toHaveText('2')
    await expect(reversal).toContainText('favoured')
  })
})

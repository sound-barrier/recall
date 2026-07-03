import { expect } from '@playwright/test'

import { test } from './_fixtures'

// Sample-size honesty (audit product gap #3): a 100% winrate over 3
// matches must not outrank 75% over 12 in the winrate breakdowns —
// rankings sort by the Wilson lower bound of the winrate's 95%
// interval, and thin samples carry a visible caveat instead of
// silently dominating the dossier.

function rec(key: string, map: string, result: 'victory' | 'defeat') {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map, hero: 'lucio', role: 'support', result,
      date: '2026-05-10', finished_at: '22:00',
    },
  }
}

// Map A: 3-0 (100%, thin). Map B: 9-3 (75%, solid). Raw-winrate
// sorting puts A first; Wilson puts B first (LB 0.47 vs 0.44).
const CORPUS = [
  ...Array.from({ length: 3 }, (_, i) => rec(`a${i}`, 'hanaoka', 'victory')),
  ...Array.from({ length: 9 }, (_, i) => rec(`bw${i}`, 'rialto', 'victory')),
  ...Array.from({ length: 3 }, (_, i) => rec(`bl${i}`, 'rialto', 'defeat')),
]

test.describe('winrate breakdown sample-size honesty', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify({ 1: ['winrate-by-map'] }))
      localStorage.setItem('recall.dashboard.widget-config.winrate-by-map',
        JSON.stringify({ minMatches: 3, limit: 5 }))
    })
    await page.route('**/api/v1/matches', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }))
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  test('ranks the solid 75% sample above the thin 100% one', async ({ page }) => {
    const widget = page.locator('[data-widget-id="winrate-by-map"]')
    await expect(widget).toBeVisible()
    const names = widget.locator('.bd-name')
    await expect(names.first()).toHaveText(/rialto/i)
    await expect(names.nth(1)).toHaveText(/hanaoka/i)
  })

  test('flags the thin sample with a visible caveat', async ({ page }) => {
    const widget = page.locator('[data-widget-id="winrate-by-map"]')
    // The n=3 row carries the low-sample marker; the n=12 row doesn't.
    await expect(widget.locator('li', { hasText: /hanaoka/i }).locator('[data-low-sample]')).toBeVisible()
    await expect(widget.locator('li', { hasText: /rialto/i }).locator('[data-low-sample]')).toHaveCount(0)
  })
})

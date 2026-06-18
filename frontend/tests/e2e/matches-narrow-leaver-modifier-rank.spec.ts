/**
 * Matches narrow — leaver-side, modifier, and rank filters.
 *
 * Three new filter dimensions in the "Narrow this set" panel:
 *   - With a leaver (by side: self / teammate / enemy)
 *   - Modifiers (multi-select OR — a match carries several rank-update pills)
 *   - Rank / tier
 * Driven in rail mode (≥1400 px, panel always visible) through the full
 * api → handler → narrow → render chain; asserts the leaves count narrows.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (i: number, o: { result: string; rank: string; leaver?: string; modifiers: string[] }) => ({
  match_key: `m${i}`,
  source_files: [`m${i}.png`],
  source_types: { [`m${i}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'tank', hero: 'ana',
    result: o.result, date: `2026-05-${String(i + 1).padStart(2, '0')}`, finished_at: '20:00',
    rank: o.rank, level: 3, rank_progress: 40, modifiers: o.modifiers,
  },
  ...(o.leaver ? { annotation: { leaver: o.leaver, members: [] } } : {}),
  parsed_at: `2026-05-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
})

// 6 matches: 3 uphill-battle/platinum, 2 reversal/diamond/enemy-leaver,
// 1 calibration/platinum/team-leaver.
const CORPUS = [
  match(0, { result: 'victory', rank: 'platinum', modifiers: ['uphill battle', 'victory'] }),
  match(1, { result: 'victory', rank: 'platinum', modifiers: ['uphill battle', 'victory'] }),
  match(2, { result: 'victory', rank: 'platinum', modifiers: ['uphill battle', 'victory'] }),
  match(3, { result: 'defeat', rank: 'diamond', leaver: 'enemy', modifiers: ['reversal', 'defeat'] }),
  match(4, { result: 'defeat', rank: 'diamond', leaver: 'enemy', modifiers: ['reversal', 'defeat'] }),
  match(5, { result: 'victory', rank: 'platinum', leaver: 'team', modifiers: ['calibration', 'victory'] }),
]

function pickChip(page: import('@playwright/test').Page, section: string, chip: string) {
  return page.locator('.np-section', { hasText: section }).locator('.np-chip', { hasText: chip }).first().click()
}

test.describe('Matches narrow — leaver / modifier / rank', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.left-panel-rail')).toBeVisible()
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(6)
  })

  test('Modifiers filter (OR) narrows to matches with the picked pill', async ({ page }) => {
    await pickChip(page, 'Modifiers', 'uphill battle')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(3)
  })

  test('With-a-leaver filter scopes to the picked side', async ({ page }) => {
    await pickChip(page, 'With a leaver', 'Enemy')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(2)
  })

  test('Rank filter scopes to the picked tier', async ({ page }) => {
    await pickChip(page, 'Rank', 'diamond')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(2)
    await expect(page.locator('.leaf-row', { hasText: 'm3' })).toHaveCount(1)
    await expect(page.locator('.leaf-row', { hasText: 'm4' })).toHaveCount(1)
    await expect(page.locator('.leaf-row', { hasText: 'm0' })).toHaveCount(0)
    await expect(page.locator('.leaf-row', { hasText: 'm1' })).toHaveCount(0)
    await expect(page.locator('.leaf-row', { hasText: 'm2' })).toHaveCount(0)
    await expect(page.locator('.leaf-row', { hasText: 'm5' })).toHaveCount(0)
  })
})

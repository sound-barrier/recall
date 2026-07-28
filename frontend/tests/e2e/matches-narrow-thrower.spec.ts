/**
 * Matches narrow — the "With a thrower" side filter.
 *
 * Throwers are the sibling of leavers: user-curated, per side. Unlike the old
 * single-value leaver enum, a match can carry a thrower on BOTH teams at once,
 * so the facet is a multi-side set and picking two sides ORs them. Driven in
 * rail mode through the full api → narrow → render chain.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (i: number, o: { throwers?: string[]; leavers?: string[] }) => ({
  match_key: `m${i}`,
  source_files: [`m${i}.png`],
  source_types: { [`m${i}.png`]: 'rank' },
  queue_type: 'role',
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'tank', hero: 'ana',
    result: 'defeat', date: `2026-05-${String(i + 1).padStart(2, '0')}`, finished_at: '20:00',
    rank: 'platinum', level: 3, rank_progress: 40, modifiers: [],
  },
  annotation: { leavers: o.leavers ?? [], throwers: o.throwers ?? [], members: [] },
  parsed_at: `2026-05-${String(i + 1).padStart(2, '0')}T20:00:00Z`,
})

// 6 matches: 2 enemy thrower, 1 team thrower, 1 with BOTH sides throwing,
// 1 leaver-but-no-thrower (the near-miss), 1 clean.
const CORPUS = [
  match(0, { throwers: ['enemy'] }),
  match(1, { throwers: ['enemy'] }),
  match(2, { throwers: ['team'] }),
  match(3, { throwers: ['team', 'enemy'] }),
  match(4, { leavers: ['team'] }),
  match(5, {}),
]

function pickChip(page: import('@playwright/test').Page, section: string, chip: string) {
  return page.locator('.np-section', { hasText: section }).locator('.np-chip', { hasText: chip }).first().click()
}

test.describe('Matches narrow — with a thrower', () => {
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

  test('scopes to the picked side, counting a both-sides match once', async ({ page }) => {
    await pickChip(page, 'With a thrower', 'Enemy')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(3)
  })

  test('a match with throwers on both teams matches either side', async ({ page }) => {
    await pickChip(page, 'With a thrower', 'Teammate')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(2)
  })

  test('two picked sides OR together', async ({ page }) => {
    await pickChip(page, 'With a thrower', 'Enemy')
    await pickChip(page, 'With a thrower', 'Teammate')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(4)
  })

  test('the thrower facet ignores a leaver-only match', async ({ page }) => {
    await pickChip(page, 'With a thrower', 'Teammate')
    // m4 carries a TEAM leaver but no thrower — the two dimensions are
    // independent, so it must not be swept in.
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.locator('.leaf-row').filter({ hasText: 'm4' })).toHaveCount(0)
  })
})

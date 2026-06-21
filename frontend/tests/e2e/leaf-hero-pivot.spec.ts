/**
 * Leaf-row hero pivot.
 *
 * Each hero in a match row is a clickable chip. Clicking one sorts that hero's
 * matches to the top of each group (most-played first) without opening the
 * detail panel; clicking the same chip again clears the pivot.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, plays: { hero: string; percent: number }[]) {
  const date = matchKey.slice(6, 16) // "2026-06-10"
  const time = matchKey.slice(17).replace(/-/g, ':') // "22-00-00" → "22:00:00"
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: plays[0]!.hero,
      result: 'victory',
      date,
      finished_at: time,
      eliminations: 17,
      assists: 16,
      deaths: 11,
      damage: 7200,
      heroes_played: plays.map((p) => ({ hero: p.hero, percent_played: p.percent, play_time: '10:00' })),
    },
    parsed_at: `${date}T${time}Z`,
  }
}

test.describe('leaf-row hero pivot', () => {
  // Same day so the three land in ONE section, regardless of the active
  // grouping — the pivot reorders within the section.
  const M1 = 'match-2026-06-10T22-00-00' // lucio, newest
  const M2 = 'match-2026-06-10T21-00-00' // ana + wuyang 40%
  const M3 = 'match-2026-06-10T20-00-00' // wuyang 100%, oldest

  test('clicking a hero chip floats that hero up without opening the panel', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record(M1, [{ hero: 'lucio', percent: 100 }]),
          record(M2, [{ hero: 'ana', percent: 60 }, { hero: 'wuyang', percent: 40 }]),
          record(M3, [{ hero: 'wuyang', percent: 100 }]),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    const rows = page.locator('.leaf-row')
    await expect(rows.first()).toBeVisible()
    // Newest-first: the lucio match leads.
    await expect(rows.first()).toHaveAttribute('data-match-key', M1)

    // Click a wuyang chip → wuyang matches float to the top (100% before 40%).
    await page.locator('.leaf-hero-chip', { hasText: 'wuyang' }).first().click()
    await expect(rows.first()).toHaveAttribute('data-match-key', M3)
    // The chip click did NOT open the detail panel.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
    // Both wuyang chips render as the active pivot.
    await expect(page.locator('.leaf-hero-chip.is-pivot')).toHaveCount(2)

    // Clicking the active chip again clears the pivot — lucio leads again.
    await page.locator('.leaf-hero-chip.is-pivot').first().click()
    await expect(rows.first()).toHaveAttribute('data-match-key', M1)
    await expect(page.locator('.leaf-hero-chip.is-pivot')).toHaveCount(0)
  })
})

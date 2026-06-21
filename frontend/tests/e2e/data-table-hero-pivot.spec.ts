/**
 * Data-table hero pivot.
 *
 * Each hero in the table's Hero cell is a clickable chip. Clicking one pivots
 * the Hero sort LEVEL on that specific hero (by percent-played) instead of the
 * most-played hero's name, integrating with the multi-level column sort — so
 * you can float, say, wuyang's games up even when wuyang isn't primary.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, plays: { hero: string; percent: number }[], date: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: plays[0]!.hero,
      result: 'victory',
      date,
      finished_at: '22:00',
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: plays.map((p) => ({ hero: p.hero, percent_played: p.percent, play_time: '10:00' })),
    },
    parsed_at: `${date}T22:30:00Z`,
  }
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

function rowKeys(page: Page) {
  return page.locator('tr.table-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}

test.describe('data table — hero pivot chip', () => {
  test('clicking a hero chip pivots the Hero sort level on that hero', async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('m1', [{ hero: 'lucio', percent: 100 }], '2026-05-12'), // newest, no wuyang
          record('m2', [{ hero: 'ana', percent: 60 }, { hero: 'wuyang', percent: 40 }], '2026-05-11'),
          record('m3', [{ hero: 'wuyang', percent: 90 }], '2026-05-10'), // oldest, top wuyang
        ]),
      }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await toDataDensity(page)

    // Default date-desc: newest (m1) first.
    expect((await rowKeys(page))[0]).toBe('m1')

    // Click a wuyang chip → wuyang's matches float up, most-played first.
    await page.locator('.tc-hero-chip', { hasText: 'wuyang' }).first().click()
    expect(await rowKeys(page)).toEqual(['m3', 'm2', 'm1'])

    // The chip click did NOT open the detail panel.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
    // The Hero header reflects the active sort level; both wuyang chips light up.
    await expect(page.locator('th[data-sort-col="hero"]')).toHaveAttribute('aria-sort', 'descending')
    await expect(page.locator('.tc-hero-chip.is-pivot')).toHaveCount(2)

    // Clicking the same chip again clears the pivot — back to date-desc.
    await page.locator('.tc-hero-chip.is-pivot').first().click()
    expect((await rowKeys(page))[0]).toBe('m1')
  })
})

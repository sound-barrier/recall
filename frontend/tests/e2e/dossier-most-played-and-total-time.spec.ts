/**
 * Dossier labels + Total time played tile.
 *
 * Three closely-related changes to the dossier:
 *
 *   1. Rename "Top X" → "Most played X" on every dossier surface
 *      (KPI eyebrow + breakdown header).
 *   2. Drop the "·N" trailing count from the Most played maps
 *      breakdown row (it was misread as part of the percent label —
 *      "33% ·1" looked like "33.1 %").
 *   3. Replace the "Top map" KPI tile with "Total time played",
 *      sourcing from data.game_length (not heroes_played play_time)
 *      summed across the narrow. Surface a "N of M matches" hint
 *      when not every record contributed a parseable game_length.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (key: string, gameLength: string | null, map = 'rialto', hero = 'lucio') => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map,
    playlist: 'competitive',
    hero,
    result: 'victory',
    date: '2026-05-10',
    finished_at: '14:00',
    ...(gameLength !== null ? { game_length: gameLength } : {}),
    heroes_played: [{ hero, play_time: gameLength ?? '00:00', percent_played: 100 }],
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

test.describe('dossier — Most played labels + Total time played', () => {
  test('renames every "Top X" eyebrow to "Most played X"', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([match('m1', '10:00', 'aatlis'), match('m2', '20:00', 'rialto')]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    // Old labels are gone.
    await expect(page.locator('.kpi-tile', { hasText: /^Top map$/ })).toHaveCount(0)
    await expect(page.locator('.kpi-tile', { hasText: /^Top hero$/ })).toHaveCount(0)
    await expect(page.locator('.breakdown-eyebrow', { hasText: /^Top maps$/ })).toHaveCount(0)
    await expect(page.locator('.breakdown-eyebrow', { hasText: /^Top heroes$/ })).toHaveCount(0)

    // New labels are present.
    await expect(page.locator('.kpi-tile', { hasText: 'Most played hero' })).toHaveCount(1)
    await expect(page.locator('.breakdown-eyebrow', { hasText: 'Most played maps' })).toHaveCount(1)
    await expect(page.locator('.breakdown-eyebrow', { hasText: 'Most played heroes' })).toHaveCount(1)
  })

  test('Most played maps row shows percent only — no "·N" suffix', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          match('m1', '10:00', 'aatlis'),
          match('m2', '10:00', 'rialto'),
          match('m3', '10:00', 'numbani'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const firstStats = page.locator('.breakdown', { hasText: 'Most played maps' })
      .locator('li').nth(0).locator('.bd-stats')
    await expect(firstStats).toHaveText('33%')
    await expect(firstStats.locator('.bd-total')).toHaveCount(0)
  })

  test('Total time played tile sums game_length across the narrow', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          match('m1', '11:25', 'aatlis'),
          match('m2', '08:54', 'rialto'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Total time played' })
    // 11:25 + 8:54 = 20m 19s → rounds to 20min.
    await expect(tile.locator('.kpi-value')).toHaveText('20min')
    // Full coverage — no "N of M" hint when every record contributed.
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })

  test('Total time tile discloses coverage when game_length is missing', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          match('m1', '10:00', 'aatlis'),
          // Rank-inferred match with no SUMMARY → no game_length.
          match('m2', null, 'suravasa'),
          match('m3', '05:00', 'numbani'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Total time played' })
    await expect(tile.locator('.kpi-value')).toHaveText('15min')
    await expect(tile.locator('.kpi-sub')).toHaveText('2 of 3 matches')
  })

  test('Total time tile renders "—" when no record has game_length', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          match('m1', null, 'aatlis'),
          match('m2', null, 'rialto'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Total time played' })
    await expect(tile.locator('.kpi-value')).toHaveText('—')
    // recordsWithTime === 0 — the "N of M" hint is suppressed because
    // there's no positive coverage to disclose.
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })
})

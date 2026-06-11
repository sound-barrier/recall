/**
 * Most-played-hero KPI tile — winrate annotation.
 *
 * The Most played hero KPI tile surfaces the time-ranked top hero plus a
 * win rate computed over matches where THAT hero's percent_played
 * cleared 20%. Sub-threshold flex picks don't drag the rate around.
 * Display: hero name on the headline line, "{n}% in {N} matches" as
 * a faint kpi-sub underneath. Hidden when no qualifying matches.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const matchWith = (
  key: string,
  result: 'victory' | 'defeat' | 'draw',
  played: { hero: string; percent_played: number }[],
) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto',
    playlist: 'competitive',
    hero: played[0]?.hero ?? 'lucio',
    result,
    date: '2026-05-10',
    finished_at: '14:00',
    heroes_played: played.map((p) => ({
      hero: p.hero, percent_played: p.percent_played, play_time: '10:00',
    })),
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

test.describe('dossier — Most played hero winrate annotation', () => {
  test('surfaces "{n}% in {N} matches" for matches where the top hero ≥ 20%', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          matchWith('m1', 'victory', [{ hero: 'lucio', percent_played: 100 }]),
          matchWith('m2', 'victory', [{ hero: 'lucio', percent_played: 80 }]),
          matchWith('m3', 'defeat',  [{ hero: 'lucio', percent_played: 60 }]),
          // Sub-threshold Lúcio flex pick — Mercy was the carry.
          matchWith('m4', 'defeat',  [
            { hero: 'lucio', percent_played: 10 },
            { hero: 'mercy', percent_played: 90 },
          ]),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Most played hero' })
    await expect(tile.locator('.kpi-value')).toHaveText('lucio')
    // 2 wins / 3 qualifying matches = 67%.
    await expect(tile.locator('.kpi-sub')).toHaveText('67% in 3 matches')
  })

  test('singular "match" when exactly one qualifies', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          matchWith('m1', 'victory', [{ hero: 'lucio', percent_played: 100 }]),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Most played hero' })
    await expect(tile.locator('.kpi-sub')).toHaveText('100% in 1 match')
  })

  test('hides the sub-label when no match clears the 20% threshold', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          // Lúcio appears in both matches but always sub-threshold.
          matchWith('m1', 'victory', [
            { hero: 'lucio', percent_played: 10 },
            { hero: 'kiriko', percent_played: 90 },
          ]),
          matchWith('m2', 'defeat', [
            { hero: 'lucio', percent_played: 15 },
            { hero: 'ana', percent_played: 85 },
          ]),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()

    const tile = page.locator('.kpi-tile', { hasText: 'Most played hero' })
    // Hero name still shows — the time leader is still lucio.
    await expect(tile.locator('.kpi-value')).toHaveText('lucio')
    // But no winrate sub-label because there are zero qualifying matches.
    await expect(tile.locator('.kpi-sub')).toHaveCount(0)
  })
})

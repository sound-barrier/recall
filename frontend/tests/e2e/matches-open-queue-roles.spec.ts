/**
 * Matches leaf row — role label for open-queue (multi-role) matches.
 *
 * Open queue lets a player touch any combination of {support, tank,
 * dps} in a single game. Pre-fix, the leaf row's role chip showed
 * only the primary hero's role (`data.role`, derived backend-side
 * from `data.hero` alone) — so a player whose heroes_played was
 * `[lucio, zarya, reaper]` saw just "support" and the secondary
 * roles were silently dropped. formatRoles now walks heroes_played
 * in percent-played order, resolves each via useOWData().heroRole,
 * and dedupes while preserving first-appearance order.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function rec(matchKey: string, heroesPlayed: { hero: string; percent: number }[]) {
  const primary = heroesPlayed[0]?.hero
  return {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map:           'rialto',
      playlist:          'competitive',
      game_mode:          'control',
      hero:          primary,
      result:        'victory',
      date:          '2026-05-10',
      finished_at:   '22:00',
      eliminations:  10,
      assists:       5,
      deaths:        3,
      heroes_played: heroesPlayed.map(h => ({
        hero: h.hero, percent_played: h.percent, play_time: '5:00',
      })),
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('Matches — open-queue role label', () => {
  test('lists every role the player touched, in percent-played order, deduped', async ({ page }) => {
    // Three matches that exercise the contract:
    //   k1 = single-role open queue (all support)        → "support"
    //   k2 = two roles, support first                    → "support, tank"
    //   k3 = three roles full spread, support → tank → dps → "support, tank, dps"
    const matches = [
      rec('k1', [
        { hero: 'lucio', percent: 60 }, { hero: 'mercy', percent: 25 }, { hero: 'ana', percent: 15 },
      ]),
      rec('k2', [
        { hero: 'lucio', percent: 50 }, { hero: 'mercy', percent: 30 }, { hero: 'd.va', percent: 20 },
      ]),
      rec('k3', [
        { hero: 'lucio',  percent: 40 },
        { hero: 'zarya',  percent: 35 },
        { hero: 'reaper', percent: 25 },
      ]),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    // The leaf rows render with the most-recently-finished match
    // first. All three matches share the same date + finished_at,
    // so the rendered order is the response order: k1, k2, k3.
    const roles = await page.locator('.leaf-role').allTextContents()
    expect(roles).toEqual(['support', 'support, tank', 'support, tank, dps'])
  })

  test('walks heroes in percent-played order, not array order', async ({ page }) => {
    // Array order: ana(10%), dva(30%), reaper(60%).
    // Percent order: reaper, dva, ana → roles: dps, tank, support.
    const matches = [rec('k1', [
      { hero: 'ana',    percent: 10 },
      { hero: 'd.va',    percent: 30 },
      { hero: 'reaper', percent: 60 },
    ])]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    await expect(page.locator('.leaf-role').first()).toHaveText('dps, tank, support')
  })
})

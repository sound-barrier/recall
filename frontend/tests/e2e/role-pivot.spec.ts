/**
 * Role pivot chip (cozy/compact + data).
 *
 * Role is rendered as clickable chips (one per role a match played — open-queue
 * matches mix dps/support/tank). Clicking a role chip pivot-sorts by that role
 * (by time in it), floating those matches to the top — mirroring the hero chips,
 * in both the leaf list and the data table.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, time: string, plays: { hero: string; percent: number }[]) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      hero: plays[0]!.hero,
      result: 'victory',
      date: '2026-05-10',
      finished_at: time,
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: plays.map((p) => ({ hero: p.hero, percent_played: p.percent, play_time: '10:00' })),
    },
    parsed_at: `2026-05-10T${time}:00Z`,
  }
}

// Same day, descending times → one date section, newest (m1) first.
const CORPUS = [
  record('m1', '22:00', [{ hero: 'lucio', percent: 100 }]), // support
  record('m2', '21:00', [{ hero: 'reaper', percent: 60 }, { hero: 'dva', percent: 40 }]), // dps + tank
  record('m3', '20:00', [{ hero: 'dva', percent: 90 }]), // tank
]

async function setup(page: Page) {
  await page.route('**/api/v1/system/reference-data', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        heroes_by_role: { support: ['lucio'], tank: ['dva'], dps: ['reaper'] },
        maps_by_game_mode: {},
      }),
    }),
  )
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
}

function tableKeys(page: Page) {
  return page.locator('tr.table-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}
function leafKeys(page: Page) {
  return page.locator('.leaf-row').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}

test.describe('role pivot chip', () => {
  test('data table: clicking a role chip pivots by that role', async ({ page }) => {
    await setup(page)
    await page.locator('.seg-btn', { hasText: 'Data' }).click()
    await expect(page.locator('table.leaves-table')).toBeVisible()
    // Wait for the reference data to resolve the role chips.
    await expect(page.locator('.tc-role-chip', { hasText: 'tank' }).first()).toBeVisible()

    expect((await tableKeys(page))[0]).toBe('m1') // default date-desc
    await page.locator('.tc-role-chip', { hasText: 'tank' }).first().click()
    // Tank matters float up: m3 (tank 90%), m2 (tank 40%), m1 (no tank).
    expect(await tableKeys(page)).toEqual(['m3', 'm2', 'm1'])
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('cozy list: clicking a role chip floats that role to the top', async ({ page }) => {
    await setup(page)
    await expect(page.locator('.leaf-role-chip', { hasText: 'tank' }).first()).toBeVisible()

    expect((await leafKeys(page))[0]).toBe('m1')
    await page.locator('.leaf-role-chip', { hasText: 'tank' }).first().click()
    expect(await leafKeys(page)).toEqual(['m3', 'm2', 'm1'])
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })
})

/**
 * Top heroes breakdown — ranked by time, not by count.
 *
 * The dossier's "Top heroes" article ranks heroes by total play time
 * summed across every `heroes_played[]` entry on every match in the
 * narrow. Capped at 3 entries. Each row's bar carries an in-bar
 * `XhYmin` / `Ymin` label and the share percentage to the right.
 *
 * This spec mocks a corpus where the time-based ranking would
 * intentionally diverge from the count-based one (mercy clicked
 * twice but for 1 min each loses to lucio clicked once for 30 min)
 * to prove the change shipped.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const matchWith = (key: string, hero: string, played: { hero: string; play_time: string }[]) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto',
    mode: 'competitive',
    hero,
    result: 'victory',
    date: '2026-05-10',
    finished_at: '14:00',
    heroes_played: played.map(h => ({ hero: h.hero, play_time: h.play_time, percent_played: 0 })),
  },
  parsed_at: '2026-05-10T14:00:00Z',
})

const CORPUS = [
  // Single 30-min Lucio match.
  matchWith('m1', 'lucio', [{ hero: 'lucio', play_time: '30:00' }]),
  // Two 1-min Mercy matches — outranks Lucio by count, but loses on time.
  matchWith('m2', 'mercy', [{ hero: 'mercy', play_time: '01:00' }]),
  matchWith('m3', 'mercy', [{ hero: 'mercy', play_time: '01:00' }]),
  // Mixed match with three heroes — wuyang adds to its own time bucket.
  matchWith('m4', 'wuyang', [
    { hero: 'wuyang', play_time: '05:00' },
    { hero: 'juno',   play_time: '03:00' },
  ]),
]

test.describe('dossier — Top heroes by time', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('orders by total play time, caps at 3, renders in-bar time labels', async ({ page }) => {
    const rows = page.locator('.breakdown', { hasText: 'Top heroes' }).locator('li')
    await expect(rows).toHaveCount(3)

    await expect(rows.nth(0).locator('.bd-name')).toHaveText('lucio')
    await expect(rows.nth(0).locator('.bd-time')).toHaveText('30min')

    await expect(rows.nth(1).locator('.bd-name')).toHaveText('wuyang')
    await expect(rows.nth(1).locator('.bd-time')).toHaveText('5min')

    // Either mercy (2 min) or juno (3 min) holds rank 3 — juno wins
    // on time even though Mercy was clicked more often. This is the
    // payoff: count-based ranking would put Mercy here.
    await expect(rows.nth(2).locator('.bd-name')).toHaveText('juno')
    await expect(rows.nth(2).locator('.bd-time')).toHaveText('3min')
  })

  test('share percentage sits beside the bar (not inside it)', async ({ page }) => {
    const rows = page.locator('.breakdown', { hasText: 'Top heroes' }).locator('li')
    // Total time = 30 + 5 + 3 + 2 = 40 min. Lucio = 75%.
    await expect(rows.nth(0).locator('.bd-stats')).toHaveText('75%')
  })

  test('Top hero KPI tile reflects the time-ranked leader', async ({ page }) => {
    const kpi = page.locator('.kpi-tile', { hasText: 'Top hero' }).locator('.kpi-value')
    await expect(kpi).toHaveText('lucio')
  })
})

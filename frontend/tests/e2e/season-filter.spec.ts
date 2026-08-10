/**
 * Season filter on the narrow panel.
 *
 * seasons.yaml (served via reference-data) drives a season <select> in the
 * Time-scope facet. A match belongs to the season its START falls in
 * (start = end − game_length), so a match that ended after a boundary but
 * began before it stays in the prior season. Picking a season narrows the
 * list and the dossier headline names it.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [
    { name: 'Reign of Talon — Season 1', chapter: 'Reign of Talon', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
    { name: 'Reign of Talon — Season 2', chapter: 'Reign of Talon', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
  ],
}

function rec(key: string, playedUTC: string, gameLength?: string) {
  return {
    match_key: `match-${key}`,
    source_files: [`${key}.png`],
    data: {
      map: 'ilios', playlist: 'competitive', hero: 'lucio', result: 'victory',
      date: playedUTC.slice(0, 10), finished_at: playedUTC.slice(11, 16),
      played_at_utc: playedUTC, game_length: gameLength,
      eliminations: 10, assists: 5, deaths: 4,
    },
    parsed_at: playedUTC,
  }
}

// Two clearly in S1, two in S2, and one that ENDS in S2 (19:10Z) but STARTED
// in S1 (18:55Z via a 15-min game) — the boundary case.
const corpus = () => ([
  rec('s1a', '2026-03-01T12:00:00Z'),
  rec('s1b', '2026-04-01T12:00:00Z'),
  rec('straddle', '2026-04-14T19:10:00Z', '15:00'), // started 18:55Z → S1
  rec('s2a', '2026-05-01T12:00:00Z'),
  rec('s2b', '2026-06-01T12:00:00Z'),
])

test.describe('season filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
  })

  async function leafCount(page: import('@playwright/test').Page): Promise<number> {
    return page.locator('.leaf-row').count()
  }

  test('picking Season 1 keeps its matches incl. a boundary-straddling one; the headline names it', async ({ page }) => {
    expect(await leafCount(page)).toBe(5)

    await page.locator('[data-narrow-trigger]').click()
    const select = page.locator('[data-np-season]')
    await expect(select).toBeVisible()
    await select.selectOption('Reign of Talon — Season 1')
    await page.getByRole('button', { name: /close filter panel/i }).click()

    // s1a, s1b, and the straddler (started before the boundary) — 3.
    await expect.poll(() => leafCount(page)).toBe(3)
    await expect(page.locator('.set-dossier')).toContainText('Reign of Talon — Season 1')
  })

  test('picking Season 2 excludes the boundary-straddling match', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('[data-np-season]').selectOption('Reign of Talon — Season 2')
    await page.getByRole('button', { name: /close filter panel/i }).click()

    // s2a, s2b only — the straddler started in S1.
    await expect.poll(() => leafCount(page)).toBe(2)
  })

  test('Any season clears the filter', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    const select = page.locator('[data-np-season]')
    await select.selectOption('Reign of Talon — Season 2')
    await select.selectOption('') // "Any season"
    await page.getByRole('button', { name: /close filter panel/i }).click()
    await expect.poll(() => leafCount(page)).toBe(5)
  })
})

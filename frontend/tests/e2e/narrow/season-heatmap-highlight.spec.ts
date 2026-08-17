/**
 * Season pick lights up the Campaign Log.
 *
 * Picking a season narrows the dossier, but the Campaign Log heatmap is a
 * filter-independent navigation surface — it always shows the full corpus. To
 * give the season pick visual feedback there, the season's day span highlights
 * on the calendar (the same accent overlay a manual date range paints), without
 * reshaping the grid.
 *
 * The season is built relative to *today* (not seasons.yaml's fixed 2026
 * windows) so its days land inside the heatmap's default trailing-6-month grid
 * regardless of the wall-clock date the suite runs on. Boundaries sit at noon
 * UTC so the local calendar date they map to is stable in every CI/dev timezone.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

function localYMD(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function daysFromToday(n: number): Date {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d
}

// noon UTC on the local calendar date n days from today.
function noonUTC(n: number): string {
  return `${localYMD(daysFromToday(n))}T12:00:00Z`
}

const SEASON_NAME = 'Live Test Season'
const inSeasonDate = localYMD(daysFromToday(-7)) // inside [today-10, today+10]
const outSeasonDate = localYMD(daysFromToday(-45)) // in-grid, outside the season

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'] },
  maps_by_game_mode: { control: ['Ilios'] },
  screenshot_sources: [],
  seasons: [
    { name: SEASON_NAME, chapter: 'Test Chapter', number: 1, start: noonUTC(-10), end: noonUTC(10) },
  ],
}

function rec(key: string, dayOffset: number) {
  const playedUTC = noonUTC(dayOffset)
  return {
    match_key: `match-${key}`,
    source_files: [`${key}.png`],
    data: {
      map: 'ilios', playlist: 'competitive', hero: 'lucio', result: 'victory',
      date: playedUTC.slice(0, 10), finished_at: '12:00',
      played_at_utc: playedUTC,
      eliminations: 10, assists: 5, deaths: 4,
    },
    parsed_at: playedUTC,
  }
}

// One populated day inside the season, one outside — so "active" tracks the
// season window, not merely "days with matches."
const corpus = () => ([rec('in', -7), rec('out', -45)])

test.describe('season highlight on the Campaign Log', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
  })

  async function pickSeason(page: Page) {
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('[data-np-season]').selectOption(SEASON_NAME)
    await page.getByRole('button', { name: /close filter panel/i }).click()
  }

  test('picking a season highlights its days on the heatmap; other days stay unlit', async ({ page }) => {
    // No date filter yet → nothing is highlighted.
    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)

    await pickSeason(page)

    // The in-season day lights up; the out-of-season day does not.
    await expect(page.locator(`.heatmap-cell.active[data-date="${inSeasonDate}"]`)).toHaveCount(1)
    await expect(page.locator(`.heatmap-cell.active[data-date="${outSeasonDate}"]`)).toHaveCount(0)
    // The span covers the whole in-grid season window, not just the one played day.
    expect(await page.locator('.heatmap-cell.active').count()).toBeGreaterThan(1)

    // The sparkline twin bands the same span.
    await expect(page.locator('.match-sparkline .selection-band')).toBeVisible()
  })

  test('clearing the season removes the highlight', async ({ page }) => {
    await pickSeason(page)
    await expect(page.locator('.heatmap-cell.active').first()).toBeVisible()

    await page.locator('[data-narrow-trigger]').click()
    await page.locator('[data-np-season]').selectOption('') // Any season
    await page.getByRole('button', { name: /close filter panel/i }).click()

    await expect(page.locator('.heatmap-cell.active')).toHaveCount(0)
  })
})

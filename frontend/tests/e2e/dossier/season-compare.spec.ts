/**
 * Season comparison view (Compare tab).
 *
 * A dedicated top-level tab puts two seasons side by side — record, win-rate
 * (with a Wilson small-sample caveat), combat rates, time, hero pool, streaks,
 * top role/hero — each row an A / B / Δ triple. A scope toggle switches between
 * comparing the FULL seasons and the currently-narrowed slice (the Matches
 * filter, minus its own season clause). Untimed matches (no derivable season)
 * belong to neither column and are surfaced as an excluded count.
 */
import type { Page, Route } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

import { test, expect } from '../_fixtures'

const S1 = 'Reign of Talon — Season 1'
const S2 = 'Reign of Talon — Season 2'

const REFERENCE_DATA = {
  heroes_by_role: { support: ['Lúcio'], dps: ['Genji'] },
  maps_by_game_mode: { control: ['Ilios', 'Nepal'] },
  screenshot_sources: [],
  seasons: [
    { name: S1, chapter: 'Reign of Talon', number: 1, start: '2026-02-10T19:00:00Z', end: '2026-04-14T19:00:00Z' },
    { name: S2, chapter: 'Reign of Talon', number: 2, start: '2026-04-14T19:00:00Z', end: '2026-06-16T19:00:00Z' },
  ], patches: [],
}

function rec(key: string, playedUTC: string, map: string, result: string) {
  return {
    match_key: `match-${key}`,
    source_files: [`${key}.png`],
    data: {
      map, playlist: 'competitive', hero: 'lucio', result,
      date: playedUTC.slice(0, 10), finished_at: playedUTC.slice(11, 16), played_at_utc: playedUTC,
      game_length: '12:00', eliminations: 10, assists: 5, deaths: 4,
      // Nepal (S2) carries a worse death rate so the Deaths row renders a
      // regressed (red ▼) delta — the ax pass then covers that color too.
      performance: { eliminations: { avg_per_10min: 18 }, deaths: { avg_per_10min: map === 'nepal' ? 10 : 6 }, assists: { avg_per_10min: 9 } },
      heroes_played: [{ hero: 'lucio', play_time: '12:00', percent_played: 100 }],
    },
    parsed_at: playedUTC,
  }
}

// S1: 2W-1L on Ilios (67%). S2: 3W-1L on Nepal (75%). Plus one undated ghost
// (no played_at_utc / sentinel key) that belongs to no season.
const corpus = () => ([
  rec('s1a', '2026-03-01T12:00:00Z', 'ilios', 'victory'),
  rec('s1b', '2026-03-05T12:00:00Z', 'ilios', 'victory'),
  rec('s1c', '2026-03-10T12:00:00Z', 'ilios', 'defeat'),
  rec('s2a', '2026-05-01T12:00:00Z', 'nepal', 'victory'),
  rec('s2b', '2026-05-05T12:00:00Z', 'nepal', 'victory'),
  rec('s2c', '2026-05-10T12:00:00Z', 'nepal', 'victory'),
  rec('s2d', '2026-05-15T12:00:00Z', 'nepal', 'defeat'),
  { match_key: 'unmatched-ghost', source_files: ['ghost.png'], parsed_at: '2026-05-20T00:00:00Z',
    data: { map: 'ilios', playlist: 'competitive', hero: 'lucio', result: 'victory', eliminations: 1, assists: 1, deaths: 1 } },
])

function cell(page: Page, rowKey: string, col: 'a' | 'b' | 'delta') {
  return page.locator(`[data-compare-row="${rowKey}"] .compare-${col}`)
}

test.describe('season comparison', () => {
  // Vue's global errorHandler swallows a thrown component error into the app's
  // banner (no pageerror), so guard the render path by watching the console line
  // the handler logs. A comparison built on the real dossier must never throw.
  let componentErrors: string[]

  test.beforeEach(async ({ page }) => {
    componentErrors = []
    page.on('console', (m) => {
      if (m.type() === 'error' && m.text().includes('unhandled component error')) componentErrors.push(m.text())
    })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
    await page.goto('/')
  })

  test.afterEach(() => {
    expect(componentErrors, 'the compare view must not throw a component error').toEqual([])
  })

  test('the Compare tab shows two seasons side by side with deltas and an excluded count', async ({ page }) => {
    await page.getByRole('tab', { name: 'Compare' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Compare' })).toBeVisible()

    // Defaults to the two most recent seasons.
    await expect(page.locator('[data-compare-a]')).toHaveValue(S1)
    await expect(page.locator('[data-compare-b]')).toHaveValue(S2)

    // Record row: 2–1–0 vs 3–1–0.
    await expect(cell(page, 'record', 'a')).toHaveText('2–1–0')
    await expect(cell(page, 'record', 'b')).toHaveText('3–1–0')

    // Win rate improved 67% → 75% = ▲ 8 pts.
    await expect(cell(page, 'winrate', 'delta')).toContainText('8 pts')
    await expect(cell(page, 'winrate', 'delta')).toContainText('▲')

    // The one undated match is surfaced as excluded, not silently dropped.
    await expect(page.locator('[data-compare-excluded]')).toContainText('1')
  })

  test('the scope toggle compares the current Matches filter instead of full seasons', async ({ page }) => {
    await page.getByRole('tab', { name: 'Compare' }).click()
    // Full-season scope: season B has all 4 Nepal games.
    await expect(cell(page, 'games', 'b')).toHaveText('4')

    // Apply a search narrow on the Matches tab that keeps only the Ilios (S1) games.
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('#np-search').fill('ilios')
    await page.getByRole('button', { name: /close filter panel/i }).click()

    // Back on Compare, switch to the current-filter scope.
    await page.getByRole('tab', { name: 'Compare' }).click()
    await page.locator('[data-compare-scope="filtered"]').click()

    // Season A (Ilios) keeps its 3 games; season B (Nepal) drops to 0.
    await expect(cell(page, 'games', 'a')).toHaveText('3')
    await expect(cell(page, 'games', 'b')).toHaveText('0')
  })
})

// Ax over the POPULATED view (both seasons are <5 decisive, so the n<5 caveat
// badge + directional delta colors actually render) across every theme — the
// empty-state ax pass in a11y.spec never exercises the table, selects, or badge.
test.describe('season comparison — accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) }))
  })

  for (const theme of ['day', 'dark', 'night', 'high-contrast'] as const) {
    test(`populated comparison (with the n<5 caveat) has no ax violations — ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => {
        try { localStorage.setItem('recall.theme', t) } catch (_) { /* ignore */ }
      }, theme)
      await page.goto('/')
      await page.getByRole('tab', { name: 'Compare' }).click()
      const panel = page.getByRole('tabpanel', { name: 'Compare' })
      await expect(panel).toBeVisible()
      // Guard: the low-sample badge must be on screen, or this proves nothing.
      await expect(page.locator('.compare-lown').first()).toBeVisible()
      await panel.evaluate((el) =>
        Promise.all(
          el.getAnimations({ subtree: true })
            .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
            .map((a) => a.finished.catch(() => undefined)),
        ),
      )
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
        .analyze()
      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([])
    })
  }
})

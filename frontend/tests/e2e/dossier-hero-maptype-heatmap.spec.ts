/**
 * Hero × game-mode heatmap widget (UI_RECOMMENDATIONS item 2).
 *
 * The widget is an opt-in dossier surface that breaks down winrate
 * by (hero, map-type) across the narrowed set. Cells are coloured
 * by winrate bucket; clicking a populated cell narrows the active
 * Matches set to that (hero, mapType) pair so the user can drill
 * into the matches that produced the surface signal.
 *
 * The widget is NOT in `DEFAULT_ROW_LAYOUT`, so this spec seeds the
 * persisted layout to include it before the page loads. That way the
 * test exercises the end-to-end render path (api.ts ↔ /api/v1/matches
 * ↔ dossier helper ↔ widget grid) rather than the customizer UI,
 * which has its own coverage.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (
  key:     string,
  hero:    string,
  type:    'control' | 'escort' | 'flashpoint' | 'hybrid' | 'push' | 'clash',
  result:  'victory' | 'defeat',
  finished: string,
) => ({
  match_key:    key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map:    'rialto',
    game_mode: type,
    hero,
    result,
    date:   '2026-05-10',
    finished_at: finished,
    playlist:   'competitive',
    heroes_played: [{ hero, play_time: '10:00', percent_played: 100 }],
  },
  parsed_at: `2026-05-10T${finished}:00Z`,
})

// Lucio is the heatmap protagonist: 6 wins + 4 losses on `control` = 60%
// winrate, 10 decisive matches — clears the default 20-match floor when
// combined with the ana row below.
const CORPUS = [
  match('m01', 'lucio', 'control', 'victory', '10:01'),
  match('m02', 'lucio', 'control', 'victory', '10:02'),
  match('m03', 'lucio', 'control', 'victory', '10:03'),
  match('m04', 'lucio', 'control', 'victory', '10:04'),
  match('m05', 'lucio', 'control', 'victory', '10:05'),
  match('m06', 'lucio', 'control', 'victory', '10:06'),
  match('m07', 'lucio', 'control', 'defeat',  '10:07'),
  match('m08', 'lucio', 'control', 'defeat',  '10:08'),
  match('m09', 'lucio', 'control', 'defeat',  '10:09'),
  match('m10', 'lucio', 'control', 'defeat',  '10:10'),
  // 12 more matches across ana/kiriko/maps to clear the 20-decisive floor.
  match('m11', 'ana',    'escort',     'victory', '10:11'),
  match('m12', 'ana',    'escort',     'victory', '10:12'),
  match('m13', 'ana',    'escort',     'defeat',  '10:13'),
  match('m14', 'ana',    'flashpoint', 'victory', '10:14'),
  match('m15', 'ana',    'flashpoint', 'defeat',  '10:15'),
  match('m16', 'ana',    'hybrid',     'victory', '10:16'),
  match('m17', 'kiriko', 'push',       'victory', '10:17'),
  match('m18', 'kiriko', 'push',       'defeat',  '10:18'),
  match('m19', 'kiriko', 'push',       'defeat',  '10:19'),
  match('m20', 'kiriko', 'clash',      'victory', '10:20'),
  match('m21', 'kiriko', 'clash',      'victory', '10:21'),
  match('m22', 'kiriko', 'clash',      'defeat',  '10:22'),
]

test.describe('dossier — Hero × game-mode heatmap', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    // Seed the persisted dashboard layout to surface the heatmap in
    // row 2 — the widget is opt-in and would otherwise be invisible.
    await page.addInitScript(() => {
      window.localStorage.setItem(
        'recall.dashboard.layout',
        JSON.stringify({
          1: ['winrate', 'avg-kda', 'total-time', 'most-played-hero'],
          2: ['hero-map-type-heatmap'],
        }),
      )
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('renders a 3-row × 6-column grid of (hero × map-type) cells', async ({ page }) => {
    const widget = page.locator('.breakdown', { hasText: 'Hero × game-mode' })
    await expect(widget).toBeVisible()
    await expect(widget.locator('.heatmap-grid')).toBeVisible()
    // 3 heroes × 6 map types = 18 cells, plus an extra row of column
    // headers. Each populated row carries one .heatmap-rowhead.
    await expect(widget.locator('.heatmap-rowhead')).toHaveCount(3)
    await expect(widget.locator('.heatmap-colhead')).toHaveCount(6)
    await expect(widget.locator('.heatmap-cell')).toHaveCount(3 * 6)
  })

  test('clicking a populated cell narrows the active set to (hero, mapType)', async ({ page }) => {
    // The lucio/control cell is the only one with 10 decisive matches
    // — its label includes "60%" + "10".
    const lucioControl = page.locator('.heatmap-cell', { hasText: '60%' }).first()
    await expect(lucioControl).toBeVisible()
    await lucioControl.click()
    // The active-clause chip row (`<ul class="active-chips">`)
    // surfaces a chip per narrow dimension; clicking a heatmap
    // cell adds a Hero chip + a Type chip. We assert the row
    // exists and both chips read the correct values.
    const chips = page.locator('ul.active-chips')
    await expect(chips).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'lucio' })).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'control' })).toBeVisible()
  })

  test('the empty-state copy surfaces when decisive matches are below the floor', async ({ page }) => {
    // Re-route to a tiny corpus that can't clear the 20-match floor.
    await page.unrouteAll({ behavior: 'wait' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          match('m01', 'lucio', 'control', 'victory', '10:01'),
          match('m02', 'lucio', 'control', 'defeat',  '10:02'),
        ]),
      })
    })
    await page.reload()
    await page.locator('#tab-matches').click()
    const widget = page.locator('.breakdown', { hasText: 'Hero × game-mode' })
    await expect(widget.locator('.heatmap-empty')).toBeVisible()
    await expect(widget.locator('.heatmap-empty')).toContainText('decisive matches')
    await expect(widget.locator('.heatmap-grid')).toHaveCount(0)
  })
})

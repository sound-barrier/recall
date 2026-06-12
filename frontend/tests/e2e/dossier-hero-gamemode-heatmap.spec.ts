/**
 * Hero × Game-Mode — full-width dossier ROW.
 *
 * Promoted from an opt-in grid widget to a section that sits below the
 * dossier grid alongside Campaign Log + Geography: it ships VISIBLE by
 * default, can be reordered/removed via the section chrome, carries a
 * 1M/3M/6M/12M trailing-window picker, and an inline gear that opens the
 * shared widget-config popover. Cells break winrate down by (hero,
 * game-mode); clicking one narrows the active set to that pair.
 *
 * Corpus dates are clock-relative (≈45 days ago) so the 6M default
 * window always includes them while the 1M window excludes them — the
 * spec stays robust against the real wall-clock CI runs under.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

// ≈45 days back: inside the 6M/3M windows, outside the 1M window.
const RECENT = daysAgo(45)

const match = (
  key:     string,
  hero:    string,
  type:    'control' | 'escort' | 'flashpoint' | 'hybrid' | 'push' | 'clash',
  result:  'victory' | 'defeat',
  finished: string,
  date = RECENT,
  map = 'rialto',
) => ({
  match_key:    key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map,
    game_mode: type,
    hero,
    result,
    date,
    finished_at: finished,
    playlist:   'competitive',
    heroes_played: [{ hero, play_time: '10:00', percent_played: 100 }],
  },
  parsed_at: `${date}T${finished}:00Z`,
})

// Lucio: 6 wins + 4 losses on `control` = 60% over 10 decisive matches.
// Plus 12 more across ana/kiriko to clear the default 20-decisive floor.
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

async function sectionOrder(page: import('@playwright/test').Page) {
  return page.locator('[data-section]').evaluateAll(
    (els) => els.map((e) => e.getAttribute('data-section')),
  )
}

test.describe('dossier — Hero × Game-Mode row', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('renders as a visible row by default with a 3×6 grid (no layout seed)', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    await expect(band).toBeVisible()
    await expect(band.locator('.heatmap-grid')).toBeVisible()
    await expect(band.locator('.heatmap-rowhead')).toHaveCount(3)
    await expect(band.locator('.heatmap-colhead')).toHaveCount(6)
    await expect(band.locator('.heatmap-cell')).toHaveCount(3 * 6)
  })

  test('clicking a cell narrows the page AND drills the band into the maps level', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    const lucioControl = band.locator('.heatmap-cell', { hasText: '60%' }).first()
    await expect(lucioControl).toBeVisible()
    await lucioControl.click()
    // Global narrow applied (the matches list reflects the drill).
    const chips = page.locator('ul.active-chips')
    await expect(chips.locator('.active-chip', { hasText: 'lucio' })).toBeVisible()
    await expect(chips.locator('.active-chip', { hasText: 'control' })).toBeVisible()
    // Band drilled — the root grid is replaced by the maps level + Go-back.
    await expect(band.locator('.heatmap-grid')).toHaveCount(0)
    await expect(band.locator('[data-hero-mode-maps]')).toBeVisible()
    await expect(band.locator('.hm-title')).toContainText('Control maps')
    await expect(band.locator('[data-hero-mode-back]')).toBeVisible()
  })

  test('the trailing-window picker filters — 1M drops the 45-day-old corpus', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    // Default 6M renders the grid.
    await expect(band.locator('.heatmap-grid')).toBeVisible()
    // 1M cutoff excludes the ~45-day-old corpus → falls below the floor.
    await band.locator('.hm-window-btn', { hasText: '1M' }).click()
    await expect(band.locator('.heatmap-empty')).toBeVisible()
    await expect(band.locator('.heatmap-grid')).toHaveCount(0)
  })

  test('the inline gear opens the config popover; raising min-matches re-renders', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    await expect(band.locator('.heatmap-grid')).toBeVisible() // 22 decisive ≥ 20
    await band.locator('[data-hero-mode-config-trigger]').click()
    const popover = page.locator('[data-testid="widget-config-popover"]')
    await expect(popover).toBeVisible()
    // Raise the floor to 50 → 22 decisive is now below it.
    await popover.locator('[data-widget-config-choice="minMatches=50"]').click()
    await popover.locator('[data-testid="widget-config-save"]').click()
    await expect(band.locator('.heatmap-empty')).toBeVisible()
  })

  test('the row is reorderable — the section grip moves it above Geography', async ({ page }) => {
    // Ships last (after campaign-log + geography).
    expect(await sectionOrder(page)).toEqual(['campaign-log', 'geography', 'hero-game-mode'])
    await page.locator('[data-section-grip="hero-game-mode"]').focus()
    await page.keyboard.press('ArrowUp')
    expect(await sectionOrder(page)).toEqual(['campaign-log', 'hero-game-mode', 'geography'])
  })

  test('the empty-state copy surfaces when decisive matches are below the floor', async ({ page }) => {
    await page.unrouteAll({ behavior: 'wait' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([
          match('m01', 'lucio', 'control', 'victory', '10:01', daysAgo(10)),
          match('m02', 'lucio', 'control', 'defeat',  '10:02', daysAgo(10)),
        ]),
      })
    })
    await page.reload()
    await page.locator('#tab-matches').click()
    const band = page.locator('.hero-mode-band')
    await expect(band.locator('.heatmap-empty')).toBeVisible()
    await expect(band.locator('.heatmap-empty')).toContainText('decisive matches')
    await expect(band.locator('.heatmap-grid')).toHaveCount(0)
  })
})

test.describe('dossier — Hero × Game-Mode drill-down', () => {
  // lucio×control spans two maps (route66 4-2, havana 2-2 → 60% over 10);
  // ana×hybrid is a single sparse match; the rest clears the 20-floor.
  const DRILL = [
    match('m01', 'lucio', 'control', 'victory', '10:01', RECENT, 'route66'),
    match('m02', 'lucio', 'control', 'victory', '10:02', RECENT, 'route66'),
    match('m03', 'lucio', 'control', 'victory', '10:03', RECENT, 'route66'),
    match('m04', 'lucio', 'control', 'victory', '10:04', RECENT, 'route66'),
    match('m05', 'lucio', 'control', 'defeat',  '10:05', RECENT, 'route66'),
    match('m06', 'lucio', 'control', 'defeat',  '10:06', RECENT, 'route66'),
    match('m07', 'lucio', 'control', 'victory', '10:07', RECENT, 'havana'),
    match('m08', 'lucio', 'control', 'victory', '10:08', RECENT, 'havana'),
    match('m09', 'lucio', 'control', 'defeat',  '10:09', RECENT, 'havana'),
    match('m10', 'lucio', 'control', 'defeat',  '10:10', RECENT, 'havana'),
    match('m11', 'ana',    'escort',     'victory', '10:11'),
    match('m12', 'ana',    'escort',     'victory', '10:12'),
    match('m13', 'ana',    'escort',     'defeat',  '10:13'),
    match('m14', 'ana',    'flashpoint', 'victory', '10:14'),
    match('m15', 'ana',    'flashpoint', 'defeat',  '10:15'),
    match('m16', 'ana',    'hybrid',     'victory', '10:16', RECENT, 'kings-row'),
    match('m17', 'kiriko', 'push',       'victory', '10:17'),
    match('m18', 'kiriko', 'push',       'defeat',  '10:18'),
    match('m19', 'kiriko', 'push',       'defeat',  '10:19'),
    match('m20', 'kiriko', 'clash',      'victory', '10:20'),
    match('m21', 'kiriko', 'clash',      'victory', '10:21'),
    match('m22', 'kiriko', 'clash',      'defeat',  '10:22'),
  ]

  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DRILL) }),
    )
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.hero-mode-band')).toBeVisible()
  })

  test('drills two levels: cell → maps → matches, applying a narrow at each step', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    const chips = page.locator('ul.active-chips .active-chip:not(.clear)')

    // L0 → L1: click the lucio×control cell (60%).
    await band.locator('.heatmap-cell', { hasText: '60%' }).first().click()
    await expect(band.locator('[data-hero-mode-maps]')).toBeVisible()
    await expect(band.locator('.hm-map-tile')).toHaveCount(2) // route66 + havana
    await expect(band.locator('.hm-title')).toContainText('Control maps')
    await expect(chips).toHaveCount(2) // Hero + Type

    // L1 → L2: click the most-played map tile (route66, 6 matches).
    await band.locator('.hm-map-tile').first().click()
    await expect(band.locator('[data-hero-mode-matches]')).toBeVisible()
    await expect(band.locator('.hm-match-row')).toHaveCount(6)
    await expect(band.locator('.hm-title')).toContainText('recent matches')
    await expect(chips).toHaveCount(3) // + Map
  })

  test('Go back pops one level at a time and clears the picks it added', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    const chips = page.locator('ul.active-chips .active-chip:not(.clear)')
    await band.locator('.heatmap-cell', { hasText: '60%' }).first().click()
    await band.locator('.hm-map-tile').first().click()
    await expect(band.locator('[data-hero-mode-matches]')).toBeVisible()

    // matches → maps (Map pick reverted).
    await band.locator('[data-hero-mode-back]').click()
    await expect(band.locator('[data-hero-mode-maps]')).toBeVisible()
    await expect(chips).toHaveCount(2)

    // maps → root (Hero + Type picks reverted).
    await band.locator('[data-hero-mode-back]').click()
    await expect(band.locator('.heatmap-grid')).toBeVisible()
    await expect(chips).toHaveCount(0)
  })

  test('a sparse drill shows the level, not the floor wall, and keeps Go-back', async ({ page }) => {
    const band = page.locator('.hero-mode-band')
    // ana×hybrid is the only 100% cell — a single match. Drilling it must
    // NOT show the "need 20+ decisive matches" wall.
    await band.locator('.heatmap-cell', { hasText: '100%' }).first().click()
    await expect(band.locator('[data-hero-mode-maps]')).toBeVisible()
    await expect(band.locator('.hm-map-tile')).toHaveCount(1)
    await expect(band.locator('.heatmap-empty')).toHaveCount(0)
    await expect(band.locator('[data-hero-mode-back]')).toBeVisible()
  })
})

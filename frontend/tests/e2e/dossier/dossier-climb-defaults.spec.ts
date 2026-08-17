/**
 * Climb-focused install defaults for the Matches dossier.
 *
 * The default widget grid leads with rank/velocity/streak/tilt (row 1)
 * and winrate-judged breakdowns (row 2). The volume + review-workflow
 * widgets that used to ship visible are demoted to the "+ Add" gallery
 * — still one click away, never deleted.
 *
 * Also covers layout migration v2: a stored v1 layout is re-seeded to
 * the new defaults exactly once, preserving widgets the user added
 * themselves while dropping the demoted old defaults.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

const RECENT = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()

const ROW1_DEFAULT = ['winrate', 'form-delta', 'net-rank-week', 'current-streak', 'tilt-check', 'avg-kda']
const ROW2_DEFAULT = ['current-rank', 'winrate-by-hero', 'winrate-by-map', 'winrate-by-role']

const DEMOTED = [
  'total-time', 'most-played-hero', 'reviewed-count', 'days-since-review',
  'wld-since-review', 'top-maps', 'top-heroes', 'top-roles', 'heroes-per-match',
]

// The pre-v2 install default, exactly as a v1 user's localStorage
// would hold it after first hydrate.
const V1_LAYOUT = {
  1: ['winrate', 'avg-kda', 'total-time', 'most-played-hero', 'reviewed-count', 'days-since-review', 'wld-since-review'],
  2: ['top-maps', 'top-heroes', 'top-roles', 'heroes-per-match'],
}

function singleMatch() {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'escort',
      role: 'support', hero: 'lucio',
      result: 'victory', date: RECENT, finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `${RECENT}T22:30:00Z`,
  }
}

async function openMatches(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([singleMatch()]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.set-dossier')).toBeVisible()
}

function rowWidgetIds(page: import('@playwright/test').Page, row: number) {
  return page
    .locator(`.dashboard-row[data-row="${row}"] [data-widget-id]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-widget-id')))
}

test.describe('climb-focused install defaults', () => {
  test('a fresh install leads with rank/velocity/streak KPIs and winrate breakdowns', async ({ page }) => {
    await openMatches(page)
    expect(await rowWidgetIds(page, 1)).toEqual(ROW1_DEFAULT)
    expect(await rowWidgetIds(page, 2)).toEqual(ROW2_DEFAULT)
  })

  test('the volume + review-workflow widgets are demoted to the Add gallery, not deleted', async ({ page }) => {
    await openMatches(page)
    for (const id of DEMOTED) {
      await expect(page.locator(`[data-widget-id="${id}"]`)).toHaveCount(0)
    }
    await page.locator('[data-dossier-add]').click()
    // Every demoted widget is offered for re-add — one click away.
    for (const id of DEMOTED) {
      await expect(page.locator(`[data-widget-add="${id}"]`)).toBeVisible()
    }
    // Re-adding one works end-to-end.
    await page.locator('[data-widget-add="reviewed-count"]').click()
    await expect(page.locator('[data-widget-id="reviewed-count"]')).toBeVisible()
  })
})

test.describe('layout migration v2 — re-seed to climb defaults', () => {
  test('a stored v1 default layout is re-seeded to the new defaults', async ({ page }) => {
    await page.addInitScript(({ layout }) => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify(layout))
      localStorage.setItem('recall.dashboard.layoutVersion', '1')
    }, { layout: V1_LAYOUT })
    await openMatches(page)
    expect(await rowWidgetIds(page, 1)).toEqual(ROW1_DEFAULT)
    expect(await rowWidgetIds(page, 2)).toEqual(ROW2_DEFAULT)
  })

  test('widgets the user added themselves survive the re-seed', async ({ page }) => {
    await page.addInitScript(({ layout }) => {
      localStorage.setItem('recall.dashboard.layout', JSON.stringify(layout))
      localStorage.setItem('recall.dashboard.layoutVersion', '1')
    }, {
      layout: {
        1: [...V1_LAYOUT[1], 'sessions'],
        2: V1_LAYOUT[2],
        3: ['time-of-day'],
      },
    })
    await openMatches(page)
    // User-added opt-ins stay (sessions in row 1, time-of-day in its
    // overflow row); the demoted old defaults are gone.
    expect(await rowWidgetIds(page, 1)).toEqual([...ROW1_DEFAULT, 'sessions'])
    await expect(page.locator('[data-widget-id="time-of-day"]')).toHaveCount(1)
    await expect(page.locator('[data-widget-id="total-time"]')).toHaveCount(0)
  })

  test('the re-seed runs once — a customized v2 layout is left alone on reload', async ({ page }) => {
    await openMatches(page)
    // Customize: trash the winrate widget under the NEW defaults.
    await page.locator('[data-widget-remove="winrate"]').click()
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)

    await page.reload()
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.set-dossier')).toBeVisible()
    // Still gone — the migration didn't stomp the user's v2 choice.
    await expect(page.locator('[data-widget-id="winrate"]')).toHaveCount(0)
  })
})

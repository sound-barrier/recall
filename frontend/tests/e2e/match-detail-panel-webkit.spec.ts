/**
 * WebKit-only regression: opening a match must keep the detail panel open.
 *
 * Commit f52988c promoted the Hero × Game-Mode heatmap from an opt-in grid
 * widget to an always-rendered dossier band. After it, the detail panel
 * header flashed open then vanished — but ONLY in the macOS Wails WKWebView
 * (Safari engine); Chromium and Firefox were unaffected, so the whole e2e
 * suite (Chromium) never caught it. This spec runs under the `webkit` project.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

// playlist set but NO top-level play_mode → MatchCardExpanded's onMounted
// auto-detect fires on open (part of the real trigger). hero + game_mode so
// the Hero × Game-Mode band actually populates.
// Recent dates (within the band's trailing window) + a couple of game
// modes so the Hero × Game-Mode heatmap actually populates cells.
const today = new Date()
function recentDate(daysAgo: number): string {
  const d = new Date(today)
  d.setDate(d.getDate() - daysAgo)
  return d.toISOString().slice(0, 10)
}
const MODES = ['control', 'hybrid', 'escort']
const CORPUS = Array.from({ length: 9 }, (_, i) => ({
  match_key: `m${i}`,
  source_files: [`m${i}.png`],
  source_types: { [`m${i}.png`]: 'summary' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: MODES[i % 3], role: 'support',
    hero: 'lucio', result: i % 2 ? 'victory' : 'defeat',
    date: recentDate(i), finished_at: '22:00',
    eliminations: 10, assists: 5, deaths: 3,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
  },
  parsed_at: `${recentDate(i)}T22:30:00Z`,
}))

test('detail panel stays open after clicking a match (Hero×Mode band, WebKit)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.route('**/api/v1/matches/*/play-mode', (route: Route) => route.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )

  await page.goto('/')
  await page.locator('#tab-matches').click()
  await page.locator('.leaf-row').first().click()

  await expect(page.locator('aside.detail-panel')).toBeVisible()
  await expect(page.locator('.detail-toolbar-title')).toContainText('Rialto')
  // The bug: the panel slides away within a beat. Hold, then re-assert.
  await page.waitForTimeout(900)
  await expect(page.locator('aside.detail-panel')).toBeVisible()
  expect(errors, `page errors:\n${errors.join('\n')}`).toEqual([])
})

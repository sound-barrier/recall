import type { Route } from '@playwright/test'
import { test, expect } from './_fixtures'

/**
 * Geography and Hero × Game-Mode read "narrow minus self" data: each reflects
 * every active filter EXCEPT its own dimension. So selecting in one band updates
 * the OTHER (they indirectly affect each other) without a band collapsing from
 * its own pick. This proves the cross-band wiring end-to-end.
 */

const REFERENCE_DATA = {
  heroes_by_role: { tank: ['Reinhardt'], dps: ['Tracer'], support: ['Ana', 'Lucio'] },
  maps_by_game_mode: { control: ['Ilios'] },
}

const today = new Date().toISOString().slice(0, 10)

function match(key: string, hero: string, finished: string) {
  return {
    match_key: key,
    data: {
      map: 'ilios', game_mode: 'control', hero, role: 'support', result: 'victory',
      date: today, finished_at: finished, playlist: 'competitive',
      heroes_played: [{ hero, play_time: '10:00', percent_played: 100 }],
    },
    parsed_at: `${today}T${finished}:00Z`,
  }
}

function games(hero: string, n: number, base: number) {
  return Array.from({ length: n }, (_, i) =>
    match(`${hero}${i}`, hero, `10:${String(base + i).padStart(2, '0')}`))
}

// All on Ilios|Support|Control so the grids are deterministic. Ana ×11 + Lucio ×11
// = 22 decisive (clears the Hero × Game-Mode 20-match floor).
const CORPUS = [...games('ana', 11, 1), ...games('lucio', 11, 20)]

test.describe('dossier — cross-widget filtering (narrow minus self)', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }))
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('a Hero × Game-Mode pick updates the Geography readout (but Geography ignores its own pick)', async ({ page }) => {
    const geo = page.locator('.match-map-role')
    const stats = geo.locator('[data-mr-selection-stats]')

    // Select Ilios|Support in Geography. Its OWN map/role pick is excluded from
    // its data, so the readout shows ALL 22 games (no self-collapse).
    await geo.locator('.mr-cell[data-mr-cell="ilios|support"]').click()
    await expect(stats).toContainText('22 games')

    // Drill Ana in Hero × Game-Mode → sets a hero filter the Geography band DOES
    // reflect → the same cell's readout drops to Ana's 11 games. Cross-band sync.
    const hm = page.locator('.hero-mode-band')
    await hm.locator('.heatmap-cell[data-hm-cell="control|ana"]').click()
    await expect(stats).toContainText('11 games')
    // The drill applied a hero filter (visible as an active chip) that Geography read.
    await expect(page.locator('ul.active-chips .active-chip', { hasText: 'ana' })).toBeVisible()
  })
})

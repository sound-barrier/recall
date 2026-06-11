/**
 * Geography band gear — a display filter for the Map × Role band.
 *
 * Opens from a gear in the band header; lets you narrow which role rows
 * + which map-type / specific-map columns the band renders. Band-only
 * (the rest of the app is untouched); multi-select & combinable (empty
 * = show all); persisted. Cells/headers still feed the global narrow.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const RECENT = (() => { const d = new Date(); d.setDate(d.getDate() - 3); return d.toISOString().slice(0, 10) })()

const REFERENCE_DATA = {
  heroes_by_role: { tank: ['Reinhardt'], dps: ['Tracer'], support: ['Lucio'] },
  // 3 types / 5 maps so the type + map filters are observable.
  maps_by_type: {
    control: ['Ilios', 'Nepal'],
    escort: ['Dorado', 'Rialto'],
    push: ['Esperanca'],
  },
}

const match = (key: string, map: string, type: string, role: string, hero: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map, type, role, hero, result: 'victory',
    date: RECENT, finished_at: '20:00', playlist: 'competitive',
    heroes_played: [{ hero, play_time: '10:00', percent_played: 100 }],
  },
  parsed_at: `${RECENT}T20:30:00Z`,
})

const CORPUS = [
  match('m1', 'rialto', 'escort', 'support', 'lucio'),
  match('m2', 'ilios', 'control', 'tank', 'reinhardt'),
  match('m3', 'esperanca', 'push', 'dps', 'tracer'),
]

const band = '.match-map-role'

test.describe('Geography band — gear filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }))
    await page.route('**/api/v1/system/reference-data', (r: Route) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(REFERENCE_DATA) }))
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator(band)).toBeVisible()
  })

  test('default shows everything; the gear opens the filter popover', async ({ page }) => {
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(3)
    await expect(page.locator(`${band} .mr-typehead`)).toHaveCount(3)
    await expect(page.locator(`${band} .mr-collabel`)).toHaveCount(5)

    await page.locator('[data-mr-config-trigger]').click()
    await expect(page.getByTestId('map-role-config')).toBeVisible()
  })

  test('role filter narrows the rows', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-role="support"]').click()

    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(1)
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveText('Support')
    // Gear flags an active filter.
    await expect(page.locator('[data-mr-config-trigger]')).toHaveClass(/mr-gear-active/)
  })

  test('map-type filter narrows the column groups', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-type="control"]').click()

    await expect(page.locator(`${band} .mr-typehead`)).toHaveCount(1)
    await expect(page.locator(`${band} .mr-typehead`)).toHaveText('Control')
    // Control has Ilios + Nepal.
    await expect(page.locator(`${band} .mr-collabel`)).toHaveCount(2)
  })

  test('pinning a specific map narrows to that column', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-map-search]').fill('rialto')
    await page.locator('[data-mr-map="Rialto"]').click()

    await expect(page.locator(`${band} .mr-collabel`)).toHaveCount(1)
    await expect(page.locator(`${band} .mr-collabel`)).toHaveText('Rialto')
  })

  test('contradictory filters show the empty state with a Clear', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    // Control type AND an Escort map → nothing matches.
    await page.locator('[data-mr-type="control"]').click()
    await page.locator('[data-mr-map-search]').fill('rialto')
    await page.locator('[data-mr-map="Rialto"]').click()

    await expect(page.locator(`${band} .mr-grid`)).toHaveCount(0)
    await page.locator('[data-mr-clear]').click()
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(3)
  })

  test('filters persist across reload; Reset clears them', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-role="support"]').click()
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(1)

    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(1)

    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-reset]').click()
    await expect(page.locator(`${band} .mr-rowhead`)).toHaveCount(3)
  })

  test('the band filter does NOT touch the global narrow', async ({ page }) => {
    await page.locator('[data-mr-config-trigger]').click()
    await page.locator('[data-mr-role="support"]').click()
    // The dossier set headline still reflects ALL matches — the gear is
    // band-local, unlike clicking a cell.
    await expect(page.locator('.dossier-eyebrow')).toHaveText('Set')
  })
})

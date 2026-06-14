/**
 * Multi-column ("Excel-style") sort for the Data-density table E2E.
 *
 * In `data` density the column headers drive an ordered STACK of sort
 * keys, not a single key: a plain header click sorts by that column
 * alone (clearing the stack), a Shift+click APPENDS the column as the
 * next tie-break level, and re-clicking a column already in the stack
 * only flips its direction. Level badges (1, 2, …) render on the active
 * headers, and the whole stack persists across reloads.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Opts {
  map?: string
  result?: 'victory' | 'defeat' | 'draw'
  elims?: number
  parsedAt?: string
}

function record(key: string, o: Opts = {}) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: o.map ?? 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: o.result ?? 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: o.elims ?? 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: o.parsedAt ?? '2026-05-10T22:30:00Z',
  }
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

function rowKeys(page: Page) {
  return page
    .locator('tr.table-row')
    .evaluateAll((rows) => rows.map((r) => r.getAttribute('data-match-key')))
}

async function mountCorpus(page: Page, corpus: unknown[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(corpus.length)
}

// Two busan matches tie on map. Their parsed_at order (newest-first
// tie-break) puts busan-loss before busan-win; a secondary Result key
// (victory before defeat) FLIPS that pair — so the order after the
// shift-click can only be produced by a real second sort level, not by
// the fallback tie-break.
const TIE_CORPUS = [
  record('busan-win', { map: 'busan', result: 'victory', parsedAt: '2026-05-10T10:00:00Z' }),
  record('busan-loss', { map: 'busan', result: 'defeat', parsedAt: '2026-05-10T22:00:00Z' }),
  record('ashe-loss', { map: 'ashe', result: 'defeat', parsedAt: '2026-05-10T15:00:00Z' }),
]

test.describe('data density — multi-column sort', () => {
  test.beforeEach(async ({ page }) => {
    await mountCorpus(page, TIE_CORPUS)
  })

  test('Shift+click appends a secondary key that breaks the primary tie', async ({ page }) => {
    await toDataDensity(page)

    // Primary: Map ascending. The busan tie falls to the newest-first
    // fallback → busan-loss (newer) before busan-win (older).
    await page.locator('th[data-sort-col="map"]').click()
    expect(await rowKeys(page)).toEqual(['ashe-loss', 'busan-loss', 'busan-win'])

    // Shift+click Result → secondary key. Within busan, victory < defeat
    // reorders the pair: busan-win now precedes busan-loss.
    await page.locator('th[data-sort-col="result"]').click({ modifiers: ['Shift'] })
    expect(await rowKeys(page)).toEqual(['ashe-loss', 'busan-win', 'busan-loss'])

    // Both active headers carry their stack position.
    await expect(page.locator('th[data-sort-col="map"] .th-level')).toHaveText('1')
    await expect(page.locator('th[data-sort-col="result"] .th-level')).toHaveText('2')
  })

  test('the multi-column sort persists across a reload', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="map"]').click()
    await page.locator('th[data-sort-col="result"]').click({ modifiers: ['Shift'] })
    expect(await rowKeys(page)).toEqual(['ashe-loss', 'busan-win', 'busan-loss'])

    await page.reload()
    await page.locator('#tab-matches').click()
    await expect(page.locator('table.leaves-table')).toBeVisible()
    // No re-click: the persisted [map asc, result asc] stack is restored.
    expect(await rowKeys(page)).toEqual(['ashe-loss', 'busan-win', 'busan-loss'])
    await expect(page.locator('th[data-sort-col="result"] .th-level')).toHaveText('2')
  })

  test('a plain click on another column collapses the stack to a single key', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="map"]').click()
    await page.locator('th[data-sort-col="result"]').click({ modifiers: ['Shift'] })
    await expect(page.locator('th[data-sort-col="map"] .th-level')).toHaveText('1')

    // Plain click Eliminations → single key; the level badges disappear
    // (a one-key stack shows a caret only, no numbered badges).
    await page.locator('th[data-sort-col="eliminations"]').click()
    await expect(page.locator('.th-level')).toHaveCount(0)
    expect(await rowKeys(page)).toEqual(['busan-loss', 'ashe-loss', 'busan-win']) // elims 5 < 15 < 25
  })
})

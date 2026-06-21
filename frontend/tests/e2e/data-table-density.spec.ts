/**
 * Data-density table E2E.
 *
 * The `data` row density renders the matches list as a flat, sortable
 * spreadsheet <table> inside a bounded scroll pane: clicking a column
 * header sorts the WHOLE table (no D/W/M/Y grouping), the When column
 * sorts by match date, the Hero column by most-played hero, dates show
 * the year only when it isn't the current year, and the pane scrolls
 * horizontally when the columns exceed the width.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Opts {
  map?: string
  hero?: string
  result?: 'victory' | 'defeat' | 'draw'
  elims?: number
  tags?: string[]
  date?: string
  finishedAt?: string
  heroesPlayed?: { hero: string; percent_played: number }[]
  parsedAt?: string
}

function record(key: string, o: Opts = {}) {
  const hero = o.hero ?? 'lucio'
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: o.map ?? 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero,
      result: o.result ?? 'victory',
      date: o.date ?? '2026-05-10',
      finished_at: o.finishedAt ?? '22:00',
      eliminations: o.elims ?? 15,
      assists: 10,
      deaths: 8,
      heroes_played: o.heroesPlayed ?? [{ hero, percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: o.parsedAt ?? '2026-05-10T22:30:00Z',
    ...(o.tags ? { annotation: { tags: o.tags } } : {}),
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

// One-day corpus — column sorts produce a distinct, observable order.
const ONE_DAY = [
  record('m-rialto', { map: 'rialto', hero: 'lucio', result: 'victory', elims: 20 }),
  record('m-busan', { map: 'busan', hero: 'mercy', result: 'defeat', elims: 10 }),
  record('m-ilios', { map: 'ilios', hero: 'ana', result: 'victory', elims: 30, tags: ['clutch'] }),
]

test.describe('data density — sortable spreadsheet table', () => {
  test.beforeEach(async ({ page }) => {
    await mountCorpus(page, ONE_DAY)
  })

  test('Data density renders a column-header <table> in a scroll pane', async ({ page }) => {
    await toDataDensity(page)
    await expect(page.locator('.leaves-table-scroll')).toBeVisible()
    await expect(page.locator('table.leaves-table thead')).toBeVisible()
    await expect(page.locator('th[data-sort-col="map"]')).toBeVisible()
    await expect(page.locator('tr.table-row')).toHaveCount(3)
  })

  test('the scroll pane is horizontally scrollable', async ({ page }) => {
    await toDataDensity(page)
    const overflowX = await page.locator('.leaves-table-scroll').evaluate(
      (el) => getComputedStyle(el).overflowX,
    )
    expect(['auto', 'scroll']).toContain(overflowX)
  })

  test('clicking a column header sorts the WHOLE table, toggling direction', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="map"]').click()
    expect(await rowKeys(page)).toEqual(['m-busan', 'm-ilios', 'm-rialto']) // ascending
    await page.locator('th[data-sort-col="map"]').click()
    expect(await rowKeys(page)).toEqual(['m-rialto', 'm-ilios', 'm-busan']) // descending
  })

  test('sorting by a numeric column (eliminations) orders numerically', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('th[data-sort-col="eliminations"]').click()
    expect(await rowKeys(page)).toEqual(['m-busan', 'm-rialto', 'm-ilios']) // 10 < 20 < 30
  })

  test('a row click opens the detail panel (interaction parity)', async ({ page }) => {
    await toDataDensity(page)
    // Click a non-interactive cell — the Hero cell is now clickable pivot chips.
    await page.locator('tr.table-row[data-match-key="m-rialto"] .tc-date').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('the scoped-search highlight (F1) renders inside cells', async ({ page }) => {
    await toDataDensity(page)
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('#np-search').fill('busan')
    await page.locator('.np-close').click()
    await expect(
      page.locator('tr.table-row[data-match-key="m-busan"] mark.search-hl'),
    ).toHaveText('busan')
  })
})

test.describe('data density — spreadsheet sort semantics', () => {
  // Distinct match dates (incl. a non-current year) + a hero whose
  // most-played differs from the primary.
  const MULTI = [
    record('jun10', { date: '2026-06-10', hero: 'lucio', heroesPlayed: [{ hero: 'ana', percent_played: 70 }, { hero: 'lucio', percent_played: 30 }] }),
    record('jun03', { date: '2026-06-03', hero: 'mercy' }),
    record('dec31', { date: '2025-12-31', hero: 'zenyatta' }),
  ]

  test('the When column sorts the whole table by MATCH date (newest first by default)', async ({ page }) => {
    await mountCorpus(page, MULTI)
    await toDataDensity(page)
    // Default is When-descending (newest match first).
    expect(await rowKeys(page)).toEqual(['jun10', 'jun03', 'dec31'])
    // Toggle to ascending (oldest match first).
    await page.locator('th[data-sort-col="date"]').click()
    expect(await rowKeys(page)).toEqual(['dec31', 'jun03', 'jun10'])
  })

  test('the Hero column sorts by the MOST-PLAYED hero, not the primary', async ({ page }) => {
    await mountCorpus(page, MULTI)
    await toDataDensity(page)
    await page.locator('th[data-sort-col="hero"]').click() // ascending by most-played
    // jun10's most-played is Ana (70%) though its primary is Lúcio.
    expect(await rowKeys(page)).toEqual(['jun10', 'jun03', 'dec31']) // ana < mercy < zenyatta
  })

  test('a non-current-year date shows the year; a current-year one does not', async ({ page }) => {
    await mountCorpus(page, MULTI)
    await toDataDensity(page)
    await expect(page.locator('tr.table-row[data-match-key="dec31"] .tc-date-d')).toContainText('2025')
    await expect(page.locator('tr.table-row[data-match-key="jun03"] .tc-date-d')).not.toContainText('20')
  })

  test('grouping does not apply in Data density — no group-header rows', async ({ page }) => {
    await mountCorpus(page, MULTI)
    // Pick "By day" while in a card density (where grouping is enabled).
    await page.locator('[data-sort-group-trigger]').click()
    await page.locator('[data-group-pick="day"]').click()
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    // Switch to Data density: the table is flat, no group dividers.
    await toDataDensity(page)
    await expect(page.locator('tr.table-row')).toHaveCount(3)
    await expect(page.locator('.table-group-head')).toHaveCount(0)
  })

  test('the members-head sort trigger opens the Custom Sort dialog in Data density', async ({ page }) => {
    await mountCorpus(page, MULTI)
    await toDataDensity(page)
    await page.locator('[data-sort-group-trigger]').click()
    // Data density sorts by column header — the trigger opens the
    // multi-column Custom Sort dialog, not the leaf sort/group popover.
    await expect(page.locator('[data-testid="table-sort-popover"]')).toBeVisible()
    await expect(page.locator('[data-testid="sort-group-popover"]')).toBeHidden()
  })
})

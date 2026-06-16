/**
 * Flat CSV export E2E.
 *
 * The data view's "Export CSV" affordance saves a one-row-per-match
 * sheet. In serveronly e2e the app runs in browser mode, so the export
 * takes the Blob + <a download> path — captured here via the download
 * event. Proves the full selection → matchesToCSV → save chain, and that
 * the bytes are Excel-ready (UTF-8 BOM + the split-column header).
 */
import { readFileSync } from 'node:fs'

import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, hero: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support',
      hero, result: 'victory', date: '2026-05-10', finished_at: '22:00',
      eliminations: 15, assists: 10, deaths: 8,
      heroes_played: [{ hero, percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

const CORPUS = [record('m-1', 'ana'), record('m-2', 'kiriko'), record('m-3', 'lucio')]

async function mountInDataDensity(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

function dataRows(content: string): string[] {
  return content.replace(/^﻿/, '').replace(/\r\n$/, '').split('\r\n').slice(1)
}

test('exports every narrowed match when nothing is selected', async ({ page }) => {
  await mountInDataDensity(page)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-csv"]').click()
  const download = await downloadPromise

  expect(download.suggestedFilename()).toMatch(/^recall-matches-.*\.csv$/)
  const content = readFileSync((await download.path())!, 'utf8')

  // UTF-8 BOM so Excel/Sheets detect the encoding.
  expect(content.startsWith('﻿')).toBe(true)
  // The split-field header (the point of the feature).
  expect(content).toContain('match_key,date,finished_at,game_length,map,game_mode,playlist,play_mode,queue_type,result')
  expect(dataRows(content)).toHaveLength(3)
})

test('exports only the ticked subset when rows are selected', async ({ page }) => {
  await mountInDataDensity(page)

  const row = page.locator('tr.table-row[data-match-key="m-2"]')
  await row.hover()
  await row.locator('.leaf-checkbox').click()
  await expect(row).toHaveClass(/is-ticked/)

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="export-csv"]').click()
  const download = await downloadPromise

  const rows = dataRows(readFileSync((await download.path())!, 'utf8'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toContain('m-2')
})

test('the bulk action bar also exports the selection to CSV', async ({ page }) => {
  await mountInDataDensity(page)

  const row = page.locator('tr.table-row[data-match-key="m-1"]')
  await row.hover()
  await row.locator('.leaf-checkbox').click()

  const downloadPromise = page.waitForEvent('download')
  await page.locator('[data-testid="bulk-export-csv"]').click()
  const download = await downloadPromise

  const rows = dataRows(readFileSync((await download.path())!, 'utf8'))
  expect(rows).toHaveLength(1)
  expect(rows[0]).toContain('m-1')
})

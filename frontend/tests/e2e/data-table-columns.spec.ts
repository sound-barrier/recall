/**
 * Data-density column contract after the climb-focused rework:
 *
 *   - Result sits right after When — outcome is the first thing
 *     scanned per row, not the last.
 *   - Stat headers speak full words (Elims / Assists / Deaths), not
 *     bare letters.
 *   - One KDA column — (Elims + Assists) / Deaths, deaths floored at
 *     1 — gives the table a sortable normalized-performance read.
 *   - The two boolean provenance columns (Edited · User entered)
 *     collapse into one Source column rendering the same badge the
 *     leaf rows use, with one sort key (OCR < edited < manual).
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Opts {
  map?: string
  result?: 'victory' | 'defeat' | 'draw'
  elims?: number | null
  assists?: number | null
  deaths?: number | null
  source?: 'ocr' | 'ocr_edited' | 'manual'
  editedFields?: string[]
  parsedAt?: string
}

function record(key: string, o: Opts = {}) {
  const rec: Record<string, unknown> = {
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
      ...(o.elims !== null ? { eliminations: o.elims ?? 15 } : {}),
      ...(o.assists !== null ? { assists: o.assists ?? 10 } : {}),
      ...(o.deaths !== null ? { deaths: o.deaths ?? 8 } : {}),
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: o.parsedAt ?? '2026-05-10T22:30:00Z',
  }
  if (o.source) rec.source = o.source
  if (o.editedFields) rec.edited_fields = o.editedFields
  return rec
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

test.describe('data density — column contract', () => {
  test('headers read When · Result · Map · … · Elims/Assists/Deaths · KDA · Tags · Source', async ({ page }) => {
    await mountCorpus(page, [record('m1')])
    await toDataDensity(page)
    const labels = await page
      .locator('.leaves-thead th')
      .evaluateAll((headers) => headers.map((th) => {
        // Label text only — the default sort renders a caret span on
        // the active column, and multi-sort adds level badges.
        const clone = th.cloneNode(true) as HTMLElement
        clone.querySelectorAll('.th-caret, .th-level').forEach((el) => el.remove())
        return clone.textContent?.trim() ?? ''
      }))
    expect(labels).toEqual([
      '', 'When', 'Result', 'Map', 'Mode', 'Queue', 'Hero', 'Role',
      'Elims', 'Assists', 'Deaths', 'KDA', 'Tags', 'Source',
    ])
  })

  test('Result renders as the second data column', async ({ page }) => {
    await mountCorpus(page, [record('m1', { result: 'victory' })])
    await toDataDensity(page)
    const secondCell = page.locator('tr.table-row td[data-col="1"]')
    await expect(secondCell.locator('.tc-result-chip')).toHaveText('victory')
  })

  test('KDA reads (Elims + Assists) / Deaths with deaths floored at 1', async ({ page }) => {
    await mountCorpus(page, [
      record('m1', { elims: 20, assists: 10, deaths: 8 }),   // 30/8 = 3.75
      record('m2', { elims: 5, assists: 5, deaths: 0, parsedAt: '2026-05-10T21:00:00Z' }),   // 10/max(1,0) = 10
      record('m3', { elims: null, assists: null, deaths: null, parsedAt: '2026-05-10T20:00:00Z' }), // no stats
    ])
    await toDataDensity(page)
    const kdaCells = page.locator('tr.table-row td[data-col="10"]')
    await expect(kdaCells.nth(0)).toHaveText('3.75')
    await expect(kdaCells.nth(1)).toHaveText('10')
    await expect(kdaCells.nth(2)).toHaveText('—')
  })

  test('the KDA header sorts by the ratio, not by raw eliminations', async ({ page }) => {
    await mountCorpus(page, [
      // high-elims has MORE elims but a WORSE ratio than low-elims.
      record('high-elims', { elims: 20, assists: 0, deaths: 10, parsedAt: '2026-05-10T22:00:00Z' }), // 2.0
      record('low-elims', { elims: 10, assists: 10, deaths: 2, parsedAt: '2026-05-10T21:00:00Z' }),  // 10.0
    ])
    await toDataDensity(page)
    await page.locator('th[data-sort-col="kda"]').click() // ascending
    expect(await rowKeys(page)).toEqual(['high-elims', 'low-elims'])
    await page.locator('th[data-sort-col="kda"]').click() // flip to descending
    expect(await rowKeys(page)).toEqual(['low-elims', 'high-elims'])
  })

  test('one Source column renders the leaf rows\' provenance badge', async ({ page }) => {
    await mountCorpus(page, [
      record('ocr-row'),
      record('edited-row', { source: 'ocr_edited', editedFields: ['map'], parsedAt: '2026-05-10T21:00:00Z' }),
      record('manual-row', { source: 'manual', parsedAt: '2026-05-10T20:00:00Z' }),
    ])
    await toDataDensity(page)
    const sourceCells = page.locator('tr.table-row td[data-col="12"]')
    await expect(sourceCells.nth(0).locator('.prov-badge')).toHaveAttribute('aria-label', /Source: OCR/)
    await expect(sourceCells.nth(1).locator('.prov-badge')).toHaveAttribute('aria-label', /Source: Edited/)
    await expect(sourceCells.nth(2).locator('.prov-badge')).toHaveAttribute('aria-label', /Source: User entered/)
    // The old two-column split is gone.
    const labels = await page
      .locator('.leaves-thead th')
      .evaluateAll((headers) => headers.map((th) => th.textContent?.trim() ?? ''))
    expect(labels).not.toContain('Edited')
    expect(labels).not.toContain('User entered')
  })

  test('the Source header sorts OCR < edited < manual', async ({ page }) => {
    await mountCorpus(page, [
      record('manual-row', { source: 'manual', parsedAt: '2026-05-10T22:00:00Z' }),
      record('ocr-row', { parsedAt: '2026-05-10T21:00:00Z' }),
      record('edited-row', { source: 'ocr_edited', editedFields: ['map'], parsedAt: '2026-05-10T20:00:00Z' }),
    ])
    await toDataDensity(page)
    await page.locator('th[data-sort-col="source"]').click() // ascending
    expect(await rowKeys(page)).toEqual(['ocr-row', 'edited-row', 'manual-row'])
  })
})

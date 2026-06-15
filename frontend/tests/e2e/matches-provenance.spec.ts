/**
 * Provenance surfacing across the Matches view.
 *
 * A match is one of three provenances: OCR (parsed, untouched),
 * ocr_edited (parsed then hand-corrected), or manual (hand-entered, no
 * screenshots). This spec drives the four places that surface it:
 *
 *   1. Narrow panel — "Provenance" chips ("Edited" / "User entered")
 *      filter the set; an active-filter chip echoes the pick.
 *   2. Data density — dedicated "Edited" + "User entered" checkbox
 *      columns tick per row (replacing the old in-row badge).
 *   3. Cozy / compact leaf rows — a hover title names edited / user-
 *      entered (there's no room for the columns there).
 *   4. Detail panel — a prominent banner at the top, equally visible
 *      for edited (with Reset to OCR) and user-entered.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function match(key: string, over: Record<string, unknown> = {}) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-05-10', finished_at: '22:00',
      eliminations: 15, assists: 10, deaths: 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:00' }],
    },
    parsed_at: '2026-05-10T22:00:00Z',
    ...over,
  }
}

const CORPUS = [
  match('ocr-1', { data: { map: 'rialto', result: 'victory', hero: 'lucio', heroes_played: [{ hero: 'lucio', percent_played: 100 }] } }),
  match('edited-1', {
    source: 'ocr_edited',
    edited_fields: ['data.map', 'data.damage'],
    data: { map: 'busan', result: 'defeat', hero: 'ana', heroes_played: [{ hero: 'ana', percent_played: 100 }] },
  }),
  match('manual-1', {
    source: 'manual',
    source_files: [],
    edited_fields: [],
    data: { map: 'ilios', result: 'victory', hero: 'mercy', heroes_played: [{ hero: 'mercy', percent_played: 100 }] },
  }),
]

async function mountCorpus(page: Page) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(CORPUS.length)
}

async function toDataDensity(page: Page) {
  await page.locator('.seg-btn', { hasText: 'Data' }).click()
  await expect(page.locator('table.leaves-table')).toBeVisible()
}

test.describe('Matches — provenance surfacing', () => {
  test.beforeEach(async ({ page }) => {
    await mountCorpus(page)
  })

  test('narrow "Provenance" chips filter the set and echo as an active chip', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()

    // "User entered" alone surfaces only the manual match.
    await page.locator('[data-source="manual"]').click()
    await expect(page.locator('.np-foot-status')).toContainText('1 match')

    // The active-filter chip strip echoes the pick.
    const chip = page.locator('[data-source-chip="manual"]')
    await expect(chip).toBeVisible()
    await expect(chip).toContainText('user entered')

    // Adding "Edited" is an OR — both touched matches, never the pure-OCR one.
    await page.locator('[data-source="ocr_edited"]').click()
    await expect(page.locator('.np-foot-status')).toContainText('2 matches')
  })

  test('Data density shows Edited + User-entered checkbox columns ticked by provenance', async ({ page }) => {
    await toDataDensity(page)

    // Both new column headers render with the right labels.
    await expect(page.locator('th[data-sort-col="edited"]')).toContainText('Edited')
    await expect(page.locator('th[data-sort-col="manual"]')).toContainText('User entered')

    const editedBox = (key: string) => page.locator(`tr.table-row[data-match-key="${key}"] .tc-prov-box`).nth(0)
    const enteredBox = (key: string) => page.locator(`tr.table-row[data-match-key="${key}"] .tc-prov-box`).nth(1)

    // Pure OCR — neither box ticked.
    await expect(editedBox('ocr-1')).not.toBeChecked()
    await expect(enteredBox('ocr-1')).not.toBeChecked()

    // Edited — only the Edited box.
    await expect(editedBox('edited-1')).toBeChecked()
    await expect(enteredBox('edited-1')).not.toBeChecked()

    // Manual — only the User-entered box.
    await expect(editedBox('manual-1')).not.toBeChecked()
    await expect(enteredBox('manual-1')).toBeChecked()
  })

  test('cozy/compact leaf rows surface provenance in the hover preview', async ({ page }) => {
    // Default density is a leaf list. Hovering a non-OCR row floats the
    // preview card carrying the provenance badge; pure OCR shows no badge.
    const preview = page.locator('.leaf-hover-preview')

    await page.locator('.leaf-row[data-match-key="manual-1"]').hover()
    await expect(preview.locator('[data-hover-prov]')).toContainText('User entered')

    await page.locator('.leaf-row[data-match-key="edited-1"]').hover()
    await expect(preview.locator('[data-hover-prov]')).toContainText('Edited')

    // Pure OCR — the preview has no provenance caption.
    await page.locator('.leaf-row[data-match-key="ocr-1"]').hover()
    await expect(preview.locator('[data-hover-prov]')).toHaveCount(0)
  })

  test('detail panel shows a prominent banner — edited (with Reset) and user-entered', async ({ page }) => {
    // Edited match → banner with the field count + Reset to OCR.
    await page.locator('.leaf-row[data-match-key="edited-1"]').click()
    const editedBanner = page.locator('[data-prov-banner]')
    await expect(editedBanner).toBeVisible()
    await expect(editedBanner).toHaveClass(/is-edited/)
    await expect(editedBanner).toContainText('Edited')
    await expect(editedBanner).toContainText('2 fields')
    await expect(editedBanner.locator('.detail-reset-btn')).toBeVisible()
    await page.keyboard.press('Escape')

    // Manual match → banner says "User entered", no Reset button.
    await page.locator('.leaf-row[data-match-key="manual-1"]').click()
    const manualBanner = page.locator('[data-prov-banner]')
    await expect(manualBanner).toBeVisible()
    await expect(manualBanner).toHaveClass(/is-manual/)
    await expect(manualBanner).toContainText('User entered')
    await expect(manualBanner.locator('.detail-reset-btn')).toHaveCount(0)
    await page.keyboard.press('Escape')

    // Pure-OCR match → no banner at all.
    await page.locator('.leaf-row[data-match-key="ocr-1"]').click()
    await expect(page.locator('[data-prov-banner]')).toHaveCount(0)
  })
})

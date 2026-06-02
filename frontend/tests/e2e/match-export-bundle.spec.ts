/**
 * Export bundle flow E2E.
 *
 * Drives the full contract through the real browser:
 *   1. Three visible matches load.
 *   2. User ticks two checkboxes → bulk-action bar appears with the
 *      "Export bundle…" button.
 *   3. Click → ExportBundleModal opens with:
 *        - "Selected matches: 2"
 *        - filename input defaulted to recall-bundle-<timestamp>.zip
 *        - hidden + unknown count toggles
 *   4. Click Export → POST /api/v1/exports/bundle fires with the
 *      ticked match_keys + the toggle values, server returns a ZIP
 *      body, browser saves it.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEYS = [
  'match-2026-05-10T22-00-00',
  'match-2026-05-10T22-30-00',
  'match-2026-05-10T23-00-00',
] as const

const HEROES = ['lucio', 'ana', 'mercy'] as const

function record(i: number) {
  return {
    match_key: KEYS[i],
    source_files: [`${KEYS[i]}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: HEROES[i],
      result: 'victory',
      date: '2026-05-10',
      finished_at: ['22:00', '22:30', '23:00'][i],
      eliminations: 10 + i,
      assists: 5,
      deaths: 3,
      damage: 5000,
      heroes_played: [{ hero: HEROES[i], percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T23:30:00Z',
  }
}

test.describe('matches — export bundle', () => {
  test('selection + modal + export call shape', async ({ page }) => {
    let bundleBody: { match_keys?: string[]; include_unknown?: boolean; include_hidden?: boolean } | null = null

    await page.route('**/api/v1/matches', async (route: Route) => {
      const records = KEYS.map((_, i) => record(i))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })
    await page.route('**/api/v1/exports/bundle', async (route: Route) => {
      bundleBody = JSON.parse(route.request().postData() ?? '{}')
      // Respond with a minimal valid ZIP (just the local-header magic
      // bytes + central-directory end record). The browser only sees
      // bytes + Content-Disposition; the bundle's correctness is
      // covered by the Go tests.
      await route.fulfill({
        status:  200,
        headers: {
          'Content-Type':        'application/zip',
          'Content-Disposition': 'attachment; filename="recall-bundle-test.zip"',
        },
        body: Buffer.from([
          0x50, 0x4b, 0x05, 0x06, // PK\x05\x06 (empty ZIP "End of central directory")
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // Tick the first two rows. Use `.leaf-checkbox` — the same
    // selector match-bulk-hide-drawer uses for the visible-list
    // checkbox affordance.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.locator('.leaf-row').nth(1).locator('.leaf-checkbox').click()

    // The bulk-action bar shows the new Export bundle button.
    const exportBtn = page.locator('[data-testid="bulk-export-bundle"]')
    await expect(exportBtn).toBeVisible()
    await exportBtn.click()

    // Modal opens with the selected count.
    const modal = page.locator('[data-testid="export-bundle-modal"]')
    await expect(modal).toBeVisible()
    await expect(modal.locator('.export-bundle-value')).toContainText('2')

    // Filename default matches the recall-bundle-<timestamp>.zip pattern.
    const filenameInput = modal.locator('[data-testid="filename"]')
    await expect(filenameInput).toHaveValue(/^recall-bundle-\d{8}-\d{6}\.zip$/)

    // Click Export. The POST /api/v1/exports/bundle handler records
    // the body so we can assert match_keys + the toggle values.
    await modal.locator('[data-testid="export-submit"]').click()

    await expect.poll(() => bundleBody).not.toBeNull()
    // Rendered order is newest-first (Sort=Newest default), so the
    // ticked first-two rows are the LATER two keys. Assert without
    // ordering — selection semantics, not list order.
    expect(bundleBody?.match_keys?.length).toBe(2)
    expect(new Set(bundleBody?.match_keys ?? [])).toEqual(new Set([KEYS[1], KEYS[2]]))
    expect(bundleBody?.include_unknown).toBe(false)
    expect(bundleBody?.include_hidden).toBe(false)

    // Modal closes on success.
    await expect(modal).toBeHidden()
  })
})

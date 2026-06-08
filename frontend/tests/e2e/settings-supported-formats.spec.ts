/**
 * Supported filename formats surface (item 10).
 *
 * Settings → Advanced → "Supported capture-source rules" collapsible
 * renders a 4-column table (Tool / Prefix / Regex / Example
 * filename) populated from /api/v1/system/reference-data's new
 * screenshot_sources field. Mock the endpoint so the test doesn't
 * depend on the binary's embedded YAML.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const SOURCES = [
  {
    name: 'nvidia',
    prefix: 'Overwatch 2 Screenshot ',
    regex: '^Overwatch 2 Screenshot ...',
    year_offset: 0,
    example: 'Overwatch 2 Screenshot 2026.05.10 - 19.57.14.89.png',
  },
  {
    name: 'prntscn',
    prefix: 'ScreenShot_',
    regex: '^ScreenShot_...',
    year_offset: 2000,
    example: 'ScreenShot_26-06-07_22-59-52-000.jpg',
  },
  {
    name: 'snip',
    prefix: 'Screenshot ',
    regex: '^Screenshot ...',
    year_offset: 0,
    example: 'Screenshot 2026-06-07 224855.png',
  },
]

test.describe('supported capture-source rules', () => {
  test('the collapsible table lists every parser-recognised source', async ({ page }) => {
    await page.route('**/api/v1/system/reference-data', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          heroes_by_role: { support: ['Lúcio'] },
          maps_by_type: { control: ['Ilios'] },
          screenshot_sources: SOURCES,
        }),
      })
    })

    await page.goto('/')
    await page.locator('#tab-settings').click()
    // Open the Advanced section — it's collapsed by default.
    const advancedDetails = page.locator('details:has(summary:has-text("Advanced"))').first()
    if (await advancedDetails.count() > 0) {
      await advancedDetails.evaluate(el => (el as HTMLDetailsElement).open = true)
    }
    // Open the supported-formats collapsible.
    const sourcesDetails = page.locator('details[data-supported-formats]')
    await sourcesDetails.evaluate(el => (el as HTMLDetailsElement).open = true)

    const rows = page.locator('details[data-supported-formats] tbody tr')
    await expect(rows).toHaveCount(SOURCES.length)
    for (const src of SOURCES) {
      const row = page.locator(`details[data-supported-formats] tbody tr[data-source-name="${src.name}"]`)
      await expect(row).toContainText(src.name)
      await expect(row).toContainText(src.prefix)
      await expect(row).toContainText(src.example)
    }
  })
})

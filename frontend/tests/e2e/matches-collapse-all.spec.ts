/**
 * Matches — collapse-all / expand-all group sections.
 *
 * The members list groups matches under date dividers (default "by day").
 * The toolbar gains an Expand all / Collapse all segmented control (only
 * in grouped, non-table modes). Collapse-all folds every section — the
 * dividers stay, the rows render zero; expand-all restores them. Proves
 * the toolbar emit → MatchesView → MatchesMembersList exposed-method chain
 * and that bulk-setting the collapse Set reflows the (section-windowed)
 * list.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const match = (key: string, date: string, time: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: { map: 'rialto', playlist: 'competitive', hero: 'ana', result: 'victory', date, finished_at: time },
  parsed_at: `${date}T${time}:00Z`,
})

// Four matches across three days → three day sections.
const CORPUS = [
  match('m1', '2026-05-10', '20:00'),
  match('m2', '2026-05-10', '21:00'),
  match('m3', '2026-05-11', '20:00'),
  match('m4', '2026-05-12', '20:00'),
]

test.describe('Matches — collapse/expand all sections', () => {
  test('collapse-all folds every day section; expand-all restores the rows', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Default: grouped by day (comfortable density) → dividers + rows.
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    const dividerCount = await page.locator('.section-divider').count()
    expect(dividerCount).toBeGreaterThanOrEqual(3)

    // Collapse all → every section folds: rows gone, dividers remain.
    await page.locator('[data-collapse-all]').click()
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    await expect(page.locator('.section-divider')).toHaveCount(dividerCount)

    // Expand all → rows come back.
    await page.locator('[data-expand-all]').click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
  })
})

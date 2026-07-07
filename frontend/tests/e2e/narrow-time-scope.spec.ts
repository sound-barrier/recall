/**
 * Time-of-day bounds on the narrow custom date range.
 *
 * OW patches land at a clock time, not a date boundary — the optional
 * From/To time inputs tighten a custom day to a minute so "after Jan 7
 * 11:00" splits a day's matches at the patch drop. Blank time = whole
 * day (the long-standing behavior); the inputs stay disabled until
 * their date is set; heatmap picks are whole-day and reset any
 * panel-set time.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function rec(key: string, date: string, time: string) {
  return {
    match_key: `match-${date}T${time.replace(':', '-')}-00`,
    source_files: [`${key}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      hero: 'lucio',
      result: 'victory',
      date,
      finished_at: time,
      eliminations: 10,
      assists: 5,
      deaths: 4,
    },
    parsed_at: `${date}T23:00:00Z`,
  }
}

const corpus = () => ([
  rec('early', '2026-01-07', '09:00'),
  rec('edge', '2026-01-07', '10:59'),
  rec('patch', '2026-01-07', '11:00'),
  rec('late', '2026-01-07', '21:57'),
  rec('nextday', '2026-01-08', '19:30'),
])

test.describe('narrow time scope', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus()) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
  })

  async function leafCount(page: import('@playwright/test').Page): Promise<number> {
    return page.locator('.leaf-row').count()
  }

  // The narrow panel keeps itself open on a field Escape (blur first),
  // so close it deterministically via its close button before reading
  // the leaf list underneath.
  async function closePanel(page: import('@playwright/test').Page) {
    await page.getByRole('button', { name: /close filter panel/i }).click()
    await expect(page.locator('#narrow-popover')).toHaveCount(0)
  }

  test('a from time splits the day at the patch boundary', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()

    const fromDate = page.locator('[data-np-from-date]')
    const fromTime = page.locator('[data-np-from-time]')
    await expect(fromTime).toBeDisabled() // no date yet → time is inert

    await fromDate.fill('2026-01-07')
    await expect(fromTime).toBeEnabled()
    await expect(fromTime).toHaveValue('')

    await fromTime.fill('11:00')
    await closePanel(page)
    await expect.poll(() => leafCount(page)).toBe(3) // patch, late, nextday

    // Clear dates resets the time too — back to the full corpus.
    await page.locator('[data-narrow-trigger]').click()
    await page.getByRole('button', { name: /clear dates/i }).click()
    await closePanel(page)
    await expect.poll(() => leafCount(page)).toBe(5)
  })

  test('a to time keeps the pre-patch side', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('[data-np-to-date]').fill('2026-01-07')
    await page.locator('[data-np-to-time]').fill('10:59')
    await closePanel(page)
    await expect.poll(() => leafCount(page)).toBe(2) // early, edge
  })

  test('a heatmap day pick resets a panel-set time to whole-day', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    await page.locator('[data-np-from-date]').fill('2026-01-07')
    await page.locator('[data-np-from-time]').fill('11:00')
    await closePanel(page)
    await expect.poll(() => leafCount(page)).toBe(3)

    // Click the Jan 7 heatmap cell: a whole-day selection — the minute
    // bound must not survive it.
    await page.locator('.heatmap-cell[data-date="2026-01-07"]').click()
    await expect.poll(() => leafCount(page)).toBe(4) // all of Jan 7
  })

  test('emptying the from date clears its time', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    const fromDate = page.locator('[data-np-from-date]')
    const fromTime = page.locator('[data-np-from-time]')
    await fromDate.fill('2026-01-07')
    await fromTime.fill('11:00')
    await fromDate.fill('')
    await expect(fromTime).toBeDisabled()
    await expect(fromTime).toHaveValue('')
    await closePanel(page)
    await expect.poll(() => leafCount(page)).toBe(5)
  })
})

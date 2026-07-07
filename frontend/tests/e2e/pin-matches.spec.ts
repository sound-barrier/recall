/**
 * Pin-matches E2E.
 *
 * Notable matches pin to a dedicated "Pinned" section above the date
 * groups, regardless of grouping/sort. The detail panel header carries
 * the toggle (★); pinned leaf rows show a star in the annotations
 * block. PUT /api/v1/matches/{key}/pin {pinned} persists; the list
 * re-partitions after the refetch.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const PINNED_KEY = 'match-2026-05-09T20-00-00'
const PLAIN_KEY = 'match-2026-05-10T21-00-00'
const PIN_PATH_GLOB = `**/api/v1/matches/${encodeURIComponent(PLAIN_KEY)}/pin`

function rec(key: string, map: string, date: string, pinned: boolean) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    data: {
      map,
      playlist: 'competitive',
      hero: 'lucio',
      result: 'victory',
      date,
      finished_at: '21:00',
      eliminations: 10,
      assists: 5,
      deaths: 3,
    },
    parsed_at: `${date}T22:00:00Z`,
    ...(pinned ? { pinned: true } : {}),
  }
}

test.describe('pin matches', () => {
  test('pinned section leads the list with starred rows', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          rec(PINNED_KEY, 'rialto', '2026-05-09', true),
          rec(PLAIN_KEY, 'numbani', '2026-05-10', false),
        ]),
      })
    })

    await page.goto('/')

    const dividers = page.locator('.section-divider')
    await expect(dividers.first()).toContainText(/pinned/i)
    // The pinned match renders inside the leading section, star visible.
    const pinnedRow = page.locator('.leaf-row', { hasText: /rialto/i })
    await expect(pinnedRow.locator('.leaf-pin')).toBeVisible()
    await expect(page.locator('.leaf-row', { hasText: /numbani/i }).locator('.leaf-pin')).toHaveCount(0)
  })

  test('panel toggle PUTs and the row moves into the pinned section', async ({ page }) => {
    let putBody: Record<string, unknown> | null = null
    let pinned = false
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          rec(PINNED_KEY, 'rialto', '2026-05-09', true),
          rec(PLAIN_KEY, 'numbani', '2026-05-10', pinned),
        ]),
      })
    })
    await page.route(PIN_PATH_GLOB, async (route: Route) => {
      putBody = JSON.parse(route.request().postData() ?? '{}')
      pinned = (putBody as { pinned: boolean }).pinned
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('.leaf-row', { hasText: /numbani/i }).click()

    const toggle = page.locator('[data-pin-toggle]')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect.poll(() => putBody).not.toBeNull()
    expect(putBody).toEqual({ pinned: true })

    // After the refetch both rows sit under the leading Pinned section.
    await expect(page.locator('[data-pin-toggle]')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.leaf-row', { hasText: /numbani/i }).locator('.leaf-pin')).toBeVisible()
  })
})

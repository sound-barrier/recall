/**
 * Unknown tab — "Delete forever" affordance on each unmatched card.
 *
 * Two-click confirm pattern (mirrors DashboardEditBanner's Reset):
 *   - first click arms the button to "Confirm delete?" + red fill
 *   - second click within 3 s fires PUT /api/v1/screenshots/{file}/ignore
 *     → 204 + records reload
 *   - first-click-only (no second) auto-disarms after 3 s
 *
 * Backend semantics: the suppress-list row goes in, the matching
 * `unmatched-<file>` row is wiped, the card disappears. The on-disk
 * file stays put.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const FILENAME = 'broken.png'
const MATCH_KEY = `unmatched-${FILENAME}`

const unknownRecord = () => ({
  match_key: MATCH_KEY,
  source_files: [FILENAME],
  source_types: { [FILENAME]: 'unknown' },
  source_dir_ids: { [FILENAME]: 0 },
  data: {},
  parsed_at: '2026-05-10T21:00:00Z',
})

test.describe('Unknown tab — Delete forever', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('two-click confirm PUTs to /screenshots/{file}/ignore and the card disappears', async ({ page }) => {
    let ignoreHits = 0
    let ignored = false

    await page.route('**/api/v1/matches', async (route: Route) => {
      // After the ignore lands the backend wipes the row; surface
      // an empty list on the subsequent refetch so the card
      // disappears.
      const body = ignored ? [] : [unknownRecord()]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
    await page.route(`**/api/v1/screenshots/${FILENAME}/ignore`, async (route: Route) => {
      ignoreHits++
      ignored = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    const card = page.locator('.unknown-card').first()
    await expect(card).toBeVisible()
    // Expand the card so the destructive zone is reachable.
    await card.locator('.unknown-card-head').click()

    const btn = page.locator(`[data-ignore-btn="${MATCH_KEY}"]`)
    await expect(btn).toHaveText(/Delete forever/i)

    // First click arms.
    await btn.click()
    await expect(btn).toHaveText(/Confirm delete\?/i)
    await expect(btn).toHaveClass(/armed/)
    // No POST yet.
    expect(ignoreHits).toBe(0)

    // Second click commits.
    await btn.click()
    await expect.poll(() => ignoreHits).toBe(1)

    // Records refetch → empty list → card gone.
    await expect(page.locator('.unknown-card')).toHaveCount(0)
  })

  // Regression — the Unknown tab also surfaces tracked matches whose
  // parser failed to extract a map (so `data.map` is empty). Their
  // `match_key` shape is `match-<ts>`, NOT `unmatched-<filename>`.
  // Pre-fix: IgnoreScreenshot only wiped unmatched- / ambiguous- keys,
  // so the underlying match-<ts> row stayed and the next reload
  // re-rendered the card. The fix looks the filename up across every
  // parent table and wipes any match_key it finds.
  test('tracked-match Unknown card (match-<ts> key) disappears after Delete forever', async ({ page }) => {
    const TRACKED_KEY = 'match-2026-05-10T22-21-11'
    const TRACKED_FILE = 'summary-2026-05-10T22-21-11.png'
    const trackedRecord = () => ({
      match_key:    TRACKED_KEY,
      source_files: [TRACKED_FILE],
      source_types: { [TRACKED_FILE]: 'summary' },
      source_dir_ids: { [TRACKED_FILE]: 0 },
      // No `data.map` — surfaces under Unknown via the
      // `!data?.map && !ambiguous` filter even though the key is a
      // tracked match.
      data:      { playlist: 'competitive', hero: 'lucio' },
      parsed_at: '2026-05-10T22:21:11Z',
    })

    let ignored = false
    let ignoreHits = 0
    await page.route('**/api/v1/matches', async (route: Route) => {
      const body = ignored ? [] : [trackedRecord()]
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(body),
      })
    })
    await page.route(`**/api/v1/screenshots/${TRACKED_FILE}/ignore`, async (route: Route) => {
      ignoreHits++
      ignored = true
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()
    await page.locator('.unknown-card .unknown-card-head').first().click()
    const btn = page.locator(`[data-ignore-btn="${TRACKED_KEY}"]`)
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(btn).toHaveText(/Confirm delete\?/i)
    await btn.click()
    await expect.poll(() => ignoreHits).toBe(1)
    // Card disappears — the regression that prompted this test was
    // exactly the card staying behind even though the POST succeeded.
    await expect(page.locator('.unknown-card')).toHaveCount(0)
  })

  test('auto-disarms after 3 s without a second click', async ({ page }) => {
    let ignoreHits = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([unknownRecord()]),
      })
    })
    await page.route(`**/api/v1/screenshots/${FILENAME}/ignore`, async (route: Route) => {
      ignoreHits++
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-unknown').click()

    await page.locator('.unknown-card .unknown-card-head').first().click()
    const btn = page.locator(`[data-ignore-btn="${MATCH_KEY}"]`)

    await btn.click()
    await expect(btn).toHaveText(/Confirm delete\?/i)

    // Wait past the 3 s auto-disarm window.
    await page.waitForTimeout(3200)
    await expect(btn).toHaveText(/Delete forever/i)
    // No POST fired during the wait.
    expect(ignoreHits).toBe(0)
  })
})

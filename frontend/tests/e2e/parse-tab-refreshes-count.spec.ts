/**
 * The Parse tab's "Run Parse · N" count must reflect what's actually on disk
 * NOW, not whatever was pending when the app first loaded. The count is fetched
 * once in the initial-load batch (while the Matches view is showing); if new
 * screenshots land before the user opens Parse, the button showed a stale
 * number and "Run Parse" could no-op or under-count. Opening the Parse tab
 * should re-fetch.
 *
 * Mocked spec: the pending-count endpoint returns one value on the initial load
 * and a higher one afterward, so a stale render and a fresh one are
 * distinguishable.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

test.describe('Parse tab refreshes the pending-screenshot count', () => {
  test('opening Parse re-fetches the count instead of showing the load-time value', async ({ page }) => {
    await page.route('**/api/v1/matches', (route: Route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
    )

    // First call (initial load, on the Matches view) → 3; every later call
    // (the Parse-tab refresh) → 8.
    let calls = 0
    await page.route('**/api/v1/screenshots/pending-count', (route: Route) => {
      calls += 1
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ count: calls === 1 ? 3 : 8 }) })
    })

    await page.goto('/')
    // The initial-load batch fetched the count once.
    await expect.poll(() => calls).toBeGreaterThanOrEqual(1)

    // Open the Parse tab — this must re-fetch and render the current value.
    await page.locator('#tab-ingest').click()
    await expect(page.locator('#tab-ingest')).toHaveAttribute('aria-selected', 'true')

    // Re-fetched: the button shows 8, not the stale load-time 3.
    await expect(page.locator('[data-testid="run-parse-btn"]')).toContainText('Run Parse · 8')
  })
})

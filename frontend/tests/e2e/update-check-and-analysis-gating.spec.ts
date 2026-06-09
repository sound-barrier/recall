/**
 * Masthead update-check button + 04 Analysis tab dev-build gating.
 *
 * Two regressions / scope decisions land here:
 *
 *   1. The "↑ update to vX.Y.Z" pill regressed when the masthead got
 *      rewired — the GitHub releases roundtrip stopped firing on
 *      mount. The replacement is intentional: a user-triggered
 *      "Check for updates" button. Clicking fires
 *      GET /api/v1/system/update and swaps the button for the
 *      appropriate result state.
 *
 *   2. The 04 Analysis tab is a work-in-progress dashboard sketch.
 *      Release users (version without "-dev") shouldn't see it; dev
 *      builds (version ending in "-dev") get the full five-tab nav.
 *
 * Spec mocks the server endpoints via page.route() so the network
 * shape stays scripted regardless of what the local server is
 * actually serving.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

async function mockVersion(page: import('@playwright/test').Page, version: string) {
  await page.route('**/api/v1/system/version', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ version }),
    })
  })
}

async function mockUpdate(page: import('@playwright/test').Page, payload: {
  checked: boolean
  dev_build: boolean
  available: boolean
  latest: string
  url: string
  latest_heroes?: string[]
  latest_maps?: string[]
  latest_sources?: string[]
  last_checked_at?: string
  release_notes?: string
  data?: {
    applied_tag: string
    applied_at?: string
    has_update: boolean
    added_heroes?: string[]
    removed_heroes?: string[]
    added_maps?: string[]
    removed_maps?: string[]
    added_sources?: string[]
    removed_sources?: string[]
  }
}) {
  await page.route('**/api/v1/system/update', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...payload,
        data: payload.data ?? { applied_tag: '', has_update: false },
      }),
    })
  })
}

test.describe('masthead — Check for updates button', () => {
  test('renders "Check for updates" by default and does NOT auto-fire on mount', async ({ page }) => {
    let updateCalls = 0
    await mockVersion(page, '0.3.0')
    await page.route('**/api/v1/system/update', async (route: Route) => {
      updateCalls++
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          checked: true, dev_build: false, available: false,
          latest: '0.3.0', url: 'https://example.test/release/0.3.0',
          data: { applied_tag: '0.3.0', has_update: false },
        }),
      })
    })

    await page.goto('/')
    await expect(page.locator('[data-update-check-trigger]')).toBeVisible()
    await expect(page.locator('[data-update-check-trigger]')).toHaveText(/check for updates/i)
    await page.waitForTimeout(300)
    expect(updateCalls).toBe(0)
  })

  test('clicking the trigger opens the modal and renders an up-to-date result', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: true, dev_build: false, available: false,
      latest: '0.3.0', url: 'https://example.test/release/0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    // Modal opens with the result.
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByText(/reference data is current/i)).toBeVisible()
  })

  test('renders the diff and an Apply button when an update is available', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: true, dev_build: false, available: true,
      latest: '0.4.0', url: 'https://example.test/release/0.4.0',
      latest_heroes: ['Phoenix'], latest_maps: ['Cascade'],
      data: { applied_tag: '0.3.0', has_update: true, added_heroes: ['Phoenix'], added_maps: ['Cascade'] },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByText('+ Hero: Phoenix')).toBeVisible()
    await expect(page.getByText('+ Map: Cascade')).toBeVisible()
    await expect(page.locator('[data-update-check-apply]')).toBeEnabled()
  })

  test('renders dev-build context with release-notes excerpt', async ({ page }) => {
    await mockVersion(page, '0.3.0-dev')
    await mockUpdate(page, {
      checked: true, dev_build: true, available: false,
      latest: '0.3.0', url: 'https://example.test/release/0.3.0',
      release_notes: 'Test release notes line',
      data: { applied_tag: '', has_update: true },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByText('Test release notes line')).toBeVisible()
  })
})

test.describe('masthead — 04 Analysis tab dev-build gating', () => {
  test('hides the Analysis tab on release builds (version without "-dev")', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: false, dev_build: false, available: false, latest: '', url: '',
    })
    await page.goto('/')

    await expect(page.locator('#tab-settings')).toBeVisible()
    await expect(page.locator('#tab-ingest')).toBeVisible()
    await expect(page.locator('#tab-matches')).toBeVisible()
    await expect(page.locator('#tab-unknown')).toBeVisible()
    await expect(page.locator('#tab-analysis')).toHaveCount(0)
  })

  test('shows the Analysis tab on dev builds (version ending in "-dev")', async ({ page }) => {
    await mockVersion(page, '0.3.0-dev')
    await mockUpdate(page, {
      checked: false, dev_build: true, available: false, latest: '', url: '',
    })
    await page.goto('/')

    await expect(page.locator('#tab-analysis')).toBeVisible()
  })

  test('keyboard nav skips Analysis on release builds (←/→ wrap stays correct)', async ({ page }) => {
    // From Matches, ArrowRight should go to Unknown directly when
    // Analysis is hidden (not to a no-op).
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: false, dev_build: false, available: false, latest: '', url: '',
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    // Press ArrowRight on the now-focused matches tab (press()
    // focuses the locator first, which matches how a keyboard user
    // would navigate from a focused tab button).
    await page.locator('#tab-matches').press('ArrowRight')
    await expect(page.locator('#tab-unknown')).toHaveAttribute('aria-selected', 'true')
  })
})

/**
 * Update-check modal — single "Update game data" button + diff
 * preview manifest. Always pulls from the main channel; Release-
 * channel YAML is gone.
 *
 * Specs mock `/api/v1/system/update` (the check) and
 * `/api/v1/system/data-update` (the apply) via page.route().
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

async function mockVersion(page: import('@playwright/test').Page, v: string) {
  await page.route('**/api/v1/system/version', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ version: v }),
    })
  })
}

interface UpdateResponse {
  available: boolean
  latest: string
  game_data?: {
    commit_sha: string
    committed_at?: string
    applied_commit: string
    applied_at?: string
    has_update: boolean
    added_heroes?: string[]
    removed_heroes?: string[]
    added_maps?: string[]
    removed_maps?: string[]
    added_sources?: string[]
    removed_sources?: string[]
  }
  release_notes?: string
}

async function mockUpdate(page: import('@playwright/test').Page, payload: UpdateResponse) {
  await page.route('**/api/v1/system/update', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        checked: true, dev_build: false,
        available: payload.available, latest: payload.latest,
        url: `https://example.test/release/${payload.latest}`,
        ...(payload.release_notes ? { release_notes: payload.release_notes } : {}),
        game_data: payload.game_data ?? { commit_sha: '', applied_commit: '', has_update: false },
      }),
    })
  })
}

test.describe('update-check modal', () => {
  test('opens with role=dialog when the trigger is clicked', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      game_data: { commit_sha: 'abc1234', applied_commit: 'abc1234', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible()
  })

  test('renders both Recall app + Game data sections', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
      },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.getByRole('heading', { name: 'Recall app' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Game data' })).toBeVisible()
    await expect(page.locator('[data-update-check-manifest]')).toContainText(/Phoenix/)
  })

  test('renders the from→to freshness header with applied + incoming commits', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
      },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    const freshness = page.locator('[data-update-check-freshness]')
    await expect(freshness).toContainText(/MAIN @ abc1234/)
    await expect(freshness).toContainText(/MAIN @ def5678/)
  })

  test('Apply button calls POST /system/data-update and shows success state', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
      },
    })
    let postFired = false
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      postFired = true
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          applied_commit: 'def5678',
          added_heroes: ['Phoenix'],
        }),
      })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply]').click()
    // Button morphs to "Applied" on success.
    await expect(page.locator('[data-update-check-apply]')).toContainText(/Applied/)
    expect(postFired).toBe(true)
  })

  test('renders an inline 422 SHA-mismatch error without closing', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
      },
    })
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      await route.fulfill({ status: 422, contentType: 'text/plain', body: 'SHA-256 verification failed' })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply]').click()
    // Modal-scoped role=alert — the page also carries a System Alert
    // ("Tesseract not detected") with role=alert in the e2e harness.
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('[role="alert"]')).toContainText(/SHA-256/i)
    await expect(dialog).toBeVisible()
  })

  test('shows the "main unreachable" state when game_data.commit_sha is empty', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      game_data: { commit_sha: '', applied_commit: '', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.locator('[data-update-check-main-unreachable]')).toBeVisible()
    await expect(page.locator('[data-update-check-apply]')).toHaveCount(0)
  })

  test('502 Pages-unreachable error surfaces inline without closing', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
      },
    })
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'main fetch failed' })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply]').click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('[role="alert"]')).toContainText(/main fetch failed/i)
    await expect(dialog).toBeVisible()
  })

  test('Esc closes the modal', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      game_data: { commit_sha: 'abc1234', applied_commit: 'abc1234', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"]')).toBeHidden()
  })
})

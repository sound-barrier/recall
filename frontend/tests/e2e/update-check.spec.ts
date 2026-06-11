/**
 * Masthead update-check button.
 *
 * The "↑ update to vX.Y.Z" pill regressed when the masthead got
 * rewired — the GitHub releases roundtrip stopped firing on mount.
 * The replacement is intentional: a user-triggered "Check for
 * updates" button. Clicking fires GET /api/v1/system/update and
 * swaps the button for the appropriate result state.
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
}) {
  await page.route('**/api/v1/system/update', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        ...payload,
        game_data: payload.game_data ?? { commit_sha: '', applied_commit: '', has_update: false },
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
          game_data: { commit_sha: 'abc1234', applied_commit: 'abc1234', has_update: false },
        }),
      })
    })

    await page.goto('/')
    await expect(page.locator('[data-update-check-trigger]')).toBeVisible()
    await expect(page.locator('[data-update-check-trigger]')).toHaveText(/check for updates/i)
    await page.waitForTimeout(300)
    expect(updateCalls).toBe(0)
  })

  test('clicking the trigger opens the modal and renders an ALL CURRENT result', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: true, dev_build: false, available: false,
      latest: '0.3.0', url: 'https://example.test/release/0.3.0',
      game_data: { commit_sha: 'abc1234', applied_commit: 'abc1234', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    // Modal opens with the result.
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByText(/all current/i)).toBeVisible()
  })

  test('renders the diff manifest and an Apply button when game data is behind', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      checked: true, dev_build: false, available: true,
      latest: '0.4.0', url: 'https://example.test/release/0.4.0',
      latest_heroes: ['Phoenix'], latest_maps: ['Cascade'],
      game_data: {
        commit_sha: 'def5678',
        applied_commit: 'abc1234',
        has_update: true,
        added_heroes: ['Phoenix'],
        added_maps: ['Cascade'],
      },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    const manifest = page.locator('[data-update-check-manifest]')
    await expect(manifest).toContainText(/Phoenix/)
    await expect(manifest).toContainText(/Cascade/)
    await expect(page.locator('[data-update-check-apply]')).toBeEnabled()
  })

  test('renders dev-build context with release-notes excerpt', async ({ page }) => {
    await mockVersion(page, '0.3.0-dev')
    await mockUpdate(page, {
      checked: true, dev_build: true, available: false,
      latest: '0.3.0', url: 'https://example.test/release/0.3.0',
      release_notes: 'Test release notes line',
      game_data: { commit_sha: 'abc1234', applied_commit: '', has_update: true },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.getByText('Test release notes line')).toBeVisible()
  })
})

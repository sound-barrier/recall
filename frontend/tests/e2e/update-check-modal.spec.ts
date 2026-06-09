/**
 * Update-check modal — driven from the masthead's "Check for updates"
 * trigger. Two sections (Recall app + Game data), Apply Update flow
 * with idle → applying → success / 422 / 409 states.
 *
 * Specs mock `/api/v1/system/update` and `/api/v1/system/data-update`
 * via page.route().
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
  data: {
    applied_tag: string
    has_update: boolean
    added_heroes?: string[]
    added_maps?: string[]
    added_sources?: string[]
  }
  main?: {
    commit_sha: string
    applied_commit: string
    has_update: boolean
    added_heroes?: string[]
    added_maps?: string[]
    added_sources?: string[]
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
        data: payload.data,
        main: payload.main ?? { commit_sha: '', applied_commit: '', has_update: false },
      }),
    })
  })
}

test.describe('update-check modal', () => {
  test('opens with role=dialog when the trigger is clicked', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"][aria-modal="true"]')).toBeVisible()
  })

  test('renders both Recall app + Game data sections', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      data: { applied_tag: '0.3.0', has_update: true, added_heroes: ['Phoenix'] },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.getByText('Recall app')).toBeVisible()
    await expect(page.getByText('Game data')).toBeVisible()
    await expect(page.getByText('+ Hero: Phoenix')).toBeVisible()
  })

  test('Apply button calls POST /system/data-update and shows success summary', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      data: { applied_tag: '0.3.0', has_update: true, added_heroes: ['Phoenix'] },
    })
    let postFired = false
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      postFired = true
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          applied_tag: '0.4.0',
          added_heroes: ['Phoenix'],
        }),
      })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply]').click()
    // Scope to the success-state headline element. The button label
    // also flips to "Applied" on success, so `getByText(/Applied/)`
    // would resolve to 2 elements under strict mode.
    const headline = page.locator('[role="dialog"] .update-check-modal-diff-headline').first()
    await expect(headline).toContainText(/Applied/)
    await expect(headline).toContainText(/v0\.4\.0/)
    expect(postFired).toBe(true)
  })

  test('renders an inline 422 SHA-mismatch error without closing', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      data: { applied_tag: '0.3.0', has_update: true, added_heroes: ['Phoenix'] },
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

  test('renders the release-race hint on 409', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: true, latest: '0.4.0',
      data: { applied_tag: '0.3.0', has_update: true, added_heroes: ['Phoenix'] },
    })
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      await route.fulfill({ status: 409, contentType: 'text/plain', body: 'release moved' })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply]').click()
    await expect(page.getByText(/release moved while the modal was open/i)).toBeVisible()
  })

  test('Main row hidden when commit_sha is empty (Pages unreachable)', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
      main: { commit_sha: '', applied_commit: '', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await expect(page.locator('[data-update-check-main-row]')).toHaveCount(0)
  })

  test('Sync from main button calls POST source=main and shows Synced summary', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
      main: { commit_sha: 'abc1234', applied_commit: '', has_update: true, added_heroes: ['Phoenix'] },
    })
    let postBody: { source?: string } | null = null
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      postBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          source: 'main', applied_commit: 'abc1234', added_heroes: ['Phoenix'],
        }),
      })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply-main]').click()
    // The main-row's idle state already prints the sha in the
    // "Main" header ("Pending → abc1234"), so scope the success
    // assertions to the success-state headline element.
    const mainRow = page.locator('[data-update-check-main-row]')
    const headline = mainRow.locator('.update-check-modal-diff-headline')
    await expect(headline).toContainText(/Synced main/i)
    await expect(headline).toContainText(/abc1234/)
    expect(postBody?.source).toBe('main')
  })

  test('Sync from main 502 surfaces inline error without closing', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
      main: { commit_sha: 'abc1234', applied_commit: '', has_update: true, added_heroes: ['Phoenix'] },
    })
    await page.route('**/api/v1/system/data-update', async (route: Route) => {
      await route.fulfill({ status: 502, contentType: 'text/plain', body: 'main fetch failed' })
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await page.locator('[data-update-check-apply-main]').click()
    const dialog = page.locator('[role="dialog"]')
    await expect(dialog.locator('[role="alert"]')).toContainText(/main fetch failed/i)
    await expect(dialog).toBeVisible()
  })

  test('Esc closes the modal', async ({ page }) => {
    await mockVersion(page, '0.3.0')
    await mockUpdate(page, {
      available: false, latest: '0.3.0',
      data: { applied_tag: '0.3.0', has_update: false },
    })
    await page.goto('/')

    await page.locator('[data-update-check-trigger]').click()
    await expect(page.locator('[role="dialog"]')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('[role="dialog"]')).toHaveCount(0)
  })
})

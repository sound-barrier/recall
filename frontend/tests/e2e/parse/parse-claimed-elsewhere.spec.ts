/**
 * The Parse tab vs screenshots another profile owns.
 *
 * A screenshot belongs to the first profile that parses it; every other
 * profile skips it, even on a shared folder. The Parse tab says how many of
 * the folder's screenshots are owned elsewhere and offers the explicit
 * override: a two-step "take them" that POSTs the takeover and reports what
 * moved.
 */
import type { Page, Route } from '@playwright/test'

import { routeCapture } from '../_capture'
import { test, expect } from '../_fixtures'

type Pending = { count: number; parked: number; claimed_elsewhere: number }

async function bootWith(page: Page, pending: Pending) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '/srv/recall' }) })
  })
  await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ path: '/usr/local/bin/tesseract', found: true, version: '5.5.0', supported: true, error: '', default: '/usr/local/bin/tesseract', platform: 'darwin' }),
    })
  })
  await page.route('**/api/v1/screenshots/pending-count', async (route: Route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pending) })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: 'Parse' }).click()
}

test.describe('Parse tab — screenshots owned by other profiles', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
  })

  test('nothing owned elsewhere: no takeover offered', async ({ page }) => {
    await bootWith(page, { count: 2, parked: 0, claimed_elsewhere: 0 })

    await expect(page.getByTestId('run-parse-btn')).toHaveText(/Run Parse · 2/)
    await expect(page.getByRole('button', { name: 'Take them' })).toHaveCount(0)
  })

  test('owned elsewhere: says how many, and taking them is a confirmed two-step', async ({ page }) => {
    await bootWith(page, { count: 0, parked: 0, claimed_elsewhere: 4 })
    const takeover = routeCapture<string>('takeover method')
    await page.route('**/api/v1/profiles/active/screenshot-claims', async (route: Route) => {
      takeover.set(route.request().method())
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ screenshots: 4, matches_moved: 2 }) })
    })

    const panel = page.locator('#panel-ingest')
    await expect(panel).toContainText(/4 screenshots in this folder belong to other profiles/)

    await page.getByRole('button', { name: 'Take them' }).click()
    await expect(panel).toContainText(/Their matches move to this profile and leave the others\./)
    expect(takeover.seen()).toBe(false)

    await page.getByRole('button', { name: 'Move them here' }).click()
    await expect.poll(() => takeover.seen()).toBe(true)
    expect(takeover.get()).toBe('POST')
    await expect(panel).toContainText(/Took 4 screenshots · 2 matches moved here\./)
  })

  test('cancel disarms without taking anything', async ({ page }) => {
    await bootWith(page, { count: 0, parked: 0, claimed_elsewhere: 1 })
    let posted = false
    await page.route('**/api/v1/profiles/active/screenshot-claims', async (route: Route) => {
      posted = true
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ screenshots: 1, matches_moved: 0 }) })
    })

    await expect(page.locator('#panel-ingest')).toContainText(/1 screenshot in this folder belongs to another profile/)
    await page.getByRole('button', { name: 'Take them' }).click()
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('button', { name: 'Take them' })).toBeVisible()
    expect(posted).toBe(false)
  })
})

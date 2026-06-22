/**
 * Parse-tab readiness checklist (TECHNICAL_DEBT #9a).
 *
 * A first-timer must satisfy TWO independent blockers before parsing — a located
 * Tesseract AND a screenshots folder. The old Parse header surfaced them one at a
 * time (fix one, return, discover the second). The checklist front-loads both:
 * one row per prerequisite with a done/outstanding state, so the user sees the
 * whole gate at once.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function tess(found: boolean) {
  return {
    path: found ? '/usr/bin/tesseract' : '',
    found,
    version: found ? '5.3.4' : '',
    supported: true,
    error: found ? '' : 'not found',
    default: '',
    platform: 'darwin',
  }
}

async function mockBoot(page: Page, opts: { found: boolean; folder: string }) {
  await page.route('**/api/v1/profiles', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ active: 'main', profiles: ['main'] }) }))
  await page.route('**/api/v1/matches', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
  await page.route('**/api/v1/settings/tesseract', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tess(opts.found)) }))
  await page.route('**/api/v1/settings/screenshots-folder', (r: Route) =>
    r.request().method() === 'GET'
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: opts.folder }) })
      : r.fulfill({ status: 204, body: '' }))
  await page.route('**/api/v1/system/screenshots-folder-candidates', (r: Route) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }))
}

test.describe('Parse-tab readiness checklist', () => {
  // The _fixtures wrapper already acks the first-run modal (sets
  // recall.firstRunAccountNamed='true'), so the Parse tab is reachable.

  test('first run shows both blockers (Tesseract + folder) as outstanding', async ({ page }) => {
    await mockBoot(page, { found: false, folder: '' })
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    const checklist = page.locator('[data-readiness-checklist]')
    await expect(checklist).toBeVisible()
    await expect(checklist.locator('[data-readiness-item="tesseract"]')).not.toHaveClass(/done/)
    await expect(checklist.locator('[data-readiness-item="folder"]')).not.toHaveClass(/done/)
  })

  test('with Tesseract ready but no folder, only the folder item is outstanding', async ({ page }) => {
    await mockBoot(page, { found: true, folder: '' })
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    const checklist = page.locator('[data-readiness-checklist]')
    await expect(checklist).toBeVisible()
    await expect(checklist.locator('[data-readiness-item="tesseract"]')).toHaveClass(/done/)
    await expect(checklist.locator('[data-readiness-item="folder"]')).not.toHaveClass(/done/)
  })

  test('both prerequisites satisfied hides the checklist', async ({ page }) => {
    await mockBoot(page, { found: true, folder: '/captures/ow' })
    await page.goto('/')
    await page.locator('#tab-ingest').click()
    await expect(page.locator('[data-readiness-checklist]')).toHaveCount(0)
  })
})

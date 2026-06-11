/**
 * Contextual callout on the screenshot source picker
 *
 * The first time the Windows 4-card source-picker grid renders,
 * Recall surfaces a one-shot ContextualCallout naming the four
 * canonical Overwatch capture pipelines. Subsequent renders skip
 * the callout because the per-id `seen` flag is in localStorage.
 *
 * Callout fires when:
 *   - platform = windows AND
 *   - candidates.length > 0 AND
 *   - recall.tour.source-picker.seen IS NOT 'true'
 *
 * The global `recall.onboardingCompleted` flag is NOT a gate —
 * contextual callouts are surface-specific orientations, not a
 * re-tutorialization of users who already skipped the full tour.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const CANDIDATES = [
  { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',                  exists: true  },
  { name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: true  },
  { name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',              exists: true  },
  { name: 'steam',   label: 'Steam install',  path: '',                                                  exists: false },
]

function tessStatus() {
  return {
    path:      '/opt/homebrew/bin/tesseract',
    found:     true,
    version:   '5.3.4',
    supported: true,
    error:     '',
    platform:  'windows',
  }
}

async function mockBoot(page: import('@playwright/test').Page) {
  await page.route('**/api/v1/matches', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([]),
  }))
  await page.route('**/api/v1/settings/tesseract', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(tessStatus()),
  }))
  await page.route('**/api/v1/settings/screenshots-folder', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/system/screenshots-folder-candidates', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(CANDIDATES),
  }))
  // Empty stats so the second metadata line stays out of the callout's way.
  await page.route('**/api/v1/system/screenshots-folder-candidates/stats', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([]),
  }))
}

test.describe('source picker — contextual callout', () => {
  test('callout surfaces on first picker render + dismisses on the Got it button', async ({ page }) => {
    // Make sure the per-id gate is clear so the callout fires. The
    // `_fixtures.ts` shared fixture has already set
    // recall.onboardingCompleted=true to skip the full tour — that's
    // intentional and does NOT block this callout.
    await page.addInitScript(() => {
      window.localStorage.removeItem('recall.tour.source-picker.seen')
    })
    await mockBoot(page)
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('[data-src-grid]')).toBeVisible()
    // Callout surfaces.
    const callout = page.locator('[data-ctx-callout]')
    await expect(callout).toBeVisible()
    await expect(callout).toContainText(/each card is one capture tool/i)
    // Click the inline "Got it" button.
    await callout.locator('.ctx-action').click()
    // Callout is gone + the per-id seen flag landed in localStorage.
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
    const seen = await page.evaluate(() => window.localStorage.getItem('recall.tour.source-picker.seen'))
    expect(seen).toBe('true')
  })

  test('callout does NOT surface when the per-id seen flag is already set', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.setItem('recall.tour.source-picker.seen', 'true')
    })
    await mockBoot(page)
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('[data-src-grid]')).toBeVisible()
    // Cards present, callout absent.
    await expect(page.locator('.src-card')).toHaveCount(4)
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
  })

  test('clicking any found card auto-dismisses the callout + persists seen', async ({ page }) => {
    await page.addInitScript(() => {
      window.localStorage.removeItem('recall.tour.source-picker.seen')
    })
    await mockBoot(page)
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('[data-ctx-callout]')).toBeVisible()
    // Click a found card (nvidia, first row).
    await page.locator('.src-card[data-src-name="nvidia"]').click()
    // Callout went away.
    await expect(page.locator('[data-ctx-callout]')).toHaveCount(0)
    const seen = await page.evaluate(() => window.localStorage.getItem('recall.tour.source-picker.seen'))
    expect(seen).toBe('true')
  })
})

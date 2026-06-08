/**
 * Per-source diagnostic strip on the picker grid (item 9).
 *
 * Once a user has been parsing for a while, the *content* of each
 * candidate folder is more useful than its mere existence:
 *   - "Nvidia Overlay · 47 files · 2h ago" — capturing here.
 *   - "OW PrntScn · 0 files"                — empty source.
 *   - "Win Snip · 12 files · 0 recognised"  — folder has files but
 *     none look like OW screenshots.
 *
 * The stats endpoint runs AFTER the grid renders so the dir walk
 * doesn't block the picker UI. This spec mocks both endpoints and
 * asserts the second metadata line surfaces with the right copy
 * per card.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const CANDIDATES = [
  { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',                  exists: true  },
  { name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: true  },
  { name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',              exists: true  },
  { name: 'steam',   label: 'Steam install',  path: '',                                                  exists: false },
]

// Mock stats: nvidia is the active source (lots of files, all
// recognised); prntscn is empty; snip has files but none look like
// OW captures (recognised_count = 0); steam is absent.
const STATS = [
  { name: 'nvidia',  file_count: 47, last_modified: new Date(Date.now() - 2 * 3600_000).toISOString(), recognised_count: 47 },
  { name: 'prntscn', file_count: 0,  last_modified: '',                                                recognised_count: 0  },
  { name: 'snip',    file_count: 12, last_modified: new Date(Date.now() - 86400_000).toISOString(),    recognised_count: 0  },
  { name: 'steam',   file_count: 0,  last_modified: '',                                                recognised_count: 0  },
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
  await page.route('**/api/v1/system/screenshots-folder-candidates/stats', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(STATS),
  }))
}

test.describe('picker per-source diagnostics', () => {
  test('every card surfaces its stats line with the right copy', async ({ page }) => {
    await mockBoot(page)
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('#panel-settings')).toBeVisible()
    await expect(page.locator('[data-src-grid]')).toBeVisible()

    // Nvidia — 47 files, all recognised, recent: "47 files · Xh ago".
    const nvidiaStats = page.locator('[data-src-stats="nvidia"]')
    await expect(nvidiaStats).toBeVisible()
    await expect(nvidiaStats).toContainText('47 files')
    await expect(nvidiaStats).toContainText('ago')
    // Recognised count omitted when everything is recognised (happy path).
    await expect(nvidiaStats).not.toContainText('recognised')

    // PrntScn — empty source: just "0 files".
    const prntStats = page.locator('[data-src-stats="prntscn"]')
    await expect(prntStats).toBeVisible()
    await expect(prntStats).toContainText('0 files')

    // Snip — files exist but none recognised: surfaces the mismatch.
    const snipStats = page.locator('[data-src-stats="snip"]')
    await expect(snipStats).toBeVisible()
    await expect(snipStats).toContainText('12 files')
    await expect(snipStats).toContainText('0 recognised')

    // Steam — absent path; stats endpoint returns zero so we surface
    // "0 files" same as PrntScn. The card already shows "not found"
    // via the existing status dot.
    const steamStats = page.locator('[data-src-stats="steam"]')
    await expect(steamStats).toContainText('0 files')
  })

  test('stats failure leaves the cards rendered but the second line absent', async ({ page }) => {
    await mockBoot(page)
    await page.unroute('**/api/v1/system/screenshots-folder-candidates/stats')
    await page.route('**/api/v1/system/screenshots-folder-candidates/stats', (route: Route) => route.fulfill({
      status: 500, contentType: 'text/plain', body: 'stats unavailable',
    }))
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('[data-src-grid]')).toBeVisible()
    // Cards still render with name/path/status; stats line stays absent.
    await expect(page.locator('.src-card')).toHaveCount(4)
    await expect(page.locator('[data-src-stats]')).toHaveCount(0)
  })
})

/**
 * Settings first-run picker — the four-source grid + custom-pick
 * tile replaces the old "Auto-Detect Folder" / "Choose Manually"
 * CTA pair on the empty-state hero.
 *
 * Contract pinned by this spec:
 *
 *   - On Windows the grid renders 4 cards (Nvidia / PrntScn / Snip
 *     / Steam) with status dots driven by the candidates endpoint.
 *   - Clicking a "found" card calls
 *     PUT /api/v1/settings/screenshots-folder with its path.
 *   - Clicking a "not found" card does nothing.
 *   - Clicking the custom-pick tile triggers PickScreenshotsDir
 *     (server mode falls back to window.prompt, so the spec just
 *     checks the tile is wired — actual prompt mocking is outside
 *     Playwright's reach).
 *   - On macOS / Linux the grid is hidden and the platform note
 *     reads "AUTO-DETECT · WINDOWS ONLY".
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const CANDIDATES_WINDOWS = [
  { name: 'nvidia',  label: 'Nvidia Overlay', path: 'C:\\Users\\J\\Videos\\Overwatch',                 exists: true  },
  { name: 'prntscn', label: 'OW default',     path: 'C:\\Users\\J\\Documents\\Overwatch\\SS\\Overwatch', exists: false },
  { name: 'snip',    label: 'Snip tool',      path: 'C:\\Users\\J\\Pictures\\Screenshots',             exists: true  },
  { name: 'steam',   label: 'Steam install',  path: '',                                                  exists: false },
]

function tessStatus(platform: 'windows' | 'darwin' | 'linux') {
  return {
    path:      '/opt/homebrew/bin/tesseract',
    found:     true,
    version:   '5.3.4',
    supported: true,
    error:     '',
    platform,
  }
}

async function mockBoot(page: import('@playwright/test').Page, opts: { platform: 'windows' | 'darwin' | 'linux'; candidates: typeof CANDIDATES_WINDOWS | [] }) {
  await page.route('**/api/v1/matches', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify([]),
  }))
  await page.route('**/api/v1/settings/tesseract', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(tessStatus(opts.platform)),
  }))
  await page.route('**/api/v1/settings/screenshots-folder', (route: Route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    }
    return route.fulfill({ status: 204, body: '' })
  })
  await page.route('**/api/v1/system/screenshots-folder-candidates', (route: Route) => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(opts.candidates),
  }))
}

test.describe('Settings — first-run screenshot source picker', () => {
  test('Windows: renders 4 cards + custom-pick tile', async ({ page }) => {
    await mockBoot(page, { platform: 'windows', candidates: CANDIDATES_WINDOWS })
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('#panel-settings')).toBeVisible()
    await expect(page.locator('[data-src-grid]')).toBeVisible()
    await expect(page.locator('.src-card')).toHaveCount(4)
    await expect(page.locator('[data-src-pick-custom]')).toBeVisible()
  })

  test('Windows: clicking a found card PUTs the path', async ({ page }) => {
    await mockBoot(page, { platform: 'windows', candidates: CANDIDATES_WINDOWS })
    let put: { body: unknown } | null = null
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'PUT') {
        put = { body: await route.request().postDataJSON() }
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    })

    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await page.locator('[data-src-name="nvidia"]').click()
    await expect.poll(() => put).not.toBeNull()
    expect((put!.body as { path: string }).path).toBe('C:\\Users\\J\\Videos\\Overwatch')
  })

  test('Windows: clicking a not-found card does nothing', async ({ page }) => {
    await mockBoot(page, { platform: 'windows', candidates: CANDIDATES_WINDOWS })
    let putFired = false
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'PUT') {
        putFired = true
        return route.fulfill({ status: 204, body: '' })
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
    })

    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await page.locator('[data-src-name="prntscn"]').click({ force: true })
    await page.waitForTimeout(200)
    expect(putFired).toBe(false)
  })

  test('macOS: hides the grid and shows the platform note', async ({ page }) => {
    await mockBoot(page, { platform: 'darwin', candidates: [] })
    await page.goto('/')
    await page.locator('button[role="tab"]', { hasText: 'Settings' }).click()
    await expect(page.locator('[data-src-grid]')).toHaveCount(0)
    await expect(page.locator('[data-src-platform-note]')).toContainText('WINDOWS ONLY')
    // Custom-pick tile still renders so the Mac user can pick their folder.
    await expect(page.locator('[data-src-pick-custom]')).toBeVisible()
  })
})

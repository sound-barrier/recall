/**
 * Settings → Advanced → "Re-parse all screenshots" — two-step arm
 * confirm + POST /api/v1/parses?scope=all wiring.
 *
 * Used to retroactively correct older records after a Recall
 * release tightens hero/map matching (e.g. the Miyazaki-misattri
 * bution fix). The destructive-tone confirm step prevents an
 * accidental multi-minute re-OCR.
 */
import type { Route } from '@playwright/test'

import { clickTwiceInPlace, test, expect } from '../_fixtures'

test.describe('Settings — Re-parse all screenshots', () => {
  test('two-step confirm fires POST /api/v1/parses?scope=all', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([]),
      })
    })
    // App.vue's `onReParseAll` early-returns when tesseractReady=false,
    // so the e2e has to mock the status endpoint to a found-binary
    // response. The CI runner has no Tesseract installed.
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/opt/homebrew/bin/tesseract',
          found: true, version: '5.3.4', supported: true,
          error: '', platform: 'darwin',
        }),
      })
    })

    let reparseUrl: string | null = null
    await page.route('**/api/v1/parses*', async (route: Route) => {
      reparseUrl = route.request().url()
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 1 }) })
    })

    await page.goto('/')
    // Switch to Settings tab.
    await page.getByRole('tab', { name: 'Settings' }).click()
    await expect(page.getByRole('tabpanel', { name: 'Settings' })).toBeVisible()

    // Open the Advanced collapsible (native <details>). Force the
    // open attribute directly because the empty-hero picker now
    // pushes the Advanced section far down the page; a real .click()
    // works manually but Playwright's auto-scroll-into-view races
    // against the staggered card-in animations above.
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    const armBtn = page.locator('[data-reparse-all-arm]')
    await expect(armBtn).toBeVisible()

    // First click ARMS. Second click on the confirm button FIRES.
    await armBtn.click()
    const confirmBtn = page.locator('[data-reparse-all-confirm]')
    await expect(confirmBtn).toBeVisible()
    await confirmBtn.click()

    await expect.poll(() => reparseUrl).not.toBeNull()
    expect(reparseUrl!).toContain('scope=all')
  })

  test('Cancel button disarms without firing the PUT', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify([]),
      })
    })
    // App.vue's `onReParseAll` early-returns when tesseractReady=false,
    // so the e2e has to mock the status endpoint to a found-binary
    // response. The CI runner has no Tesseract installed.
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/opt/homebrew/bin/tesseract',
          found: true, version: '5.3.4', supported: true,
          error: '', platform: 'darwin',
        }),
      })
    })
    let fired = false
    await page.route('**/api/v1/parses*', async (route: Route) => {
      fired = true
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 1 }) })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    await page.locator('[data-reparse-all-arm]').click()
    // Click Cancel inside the confirm group.
    await page.locator('.clear-confirm-group .btn.ghost').first().click()
    // Wait briefly to be sure no PUT fires after disarm.
    await page.waitForTimeout(200)
    expect(fired).toBe(false)
    // The arm button is visible again.
    await expect(page.locator('[data-reparse-all-arm]')).toBeVisible()
  })
})

/**
 * Arming a destructive row (re-parse all, clear database, restore) must
 * SHOW that it is armed, on every theme, without shoving the row's content
 * sideways while the user reads it. The armed treatment once lived in
 * SettingsView's scoped block while the rows render inside child section
 * components, which scoped CSS cannot reach: an armed row looked exactly
 * like an idle one on every theme but Day.
 */
const THEMES = ['night', 'day'] as const

for (const theme of THEMES) {
  test(`an armed destructive row is visibly marked and does not shift (${theme})`, async ({ page }) => {
    await page.addInitScript(t => localStorage.setItem('recall.theme', t), theme)
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/usr/bin/tesseract', found: true, version: '5.3.4',
          supported: true, error: '', platform: 'linux',
        }),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)

    const label = page.getByRole('heading', { name: /Re-parse All Screenshots/ })
    const row = page.locator('.setting-row', { has: label })
    // A sibling destructive row that stays idle: the reference the armed
    // row must stand out from, read at the same moment so a transition or
    // a stray :hover can't fake the difference.
    const idleSibling = page.locator('.setting-row', {
      has: page.getByRole('heading', { name: /Clear Parse Database/ }),
    })
    await expect(label).toBeVisible()
    const idleLabelX = (await label.boundingBox())!.x

    await page.locator('[data-reparse-all-arm]').click()
    await expect(page.locator('[data-reparse-all-confirm]')).toBeVisible()
    await page.mouse.move(0, 0)

    // Read only once every transition on the row has finished: a sample
    // taken mid-fade differs from its idle sibling whether or not the
    // armed treatment exists.
    await row.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished)))
    const background = (loc: typeof row) => loc.evaluate(el => getComputedStyle(el).backgroundColor)
    expect(await background(row)).not.toBe(await background(idleSibling))
    await expect.poll(async () => (await label.boundingBox())!.x).toBe(idleLabelX)
  })
}

test.describe('Settings — Advanced arm/confirm under a double-click', () => {
  // Confirm takes the arm button's place, so the second click of a
  // double-click used to start a full re-OCR of every screenshot.
  test('a double-click on Re-parse all… arms it and starts nothing', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/settings/tesseract', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify({
          path: '/opt/homebrew/bin/tesseract', found: true, version: '5.3.4', supported: true, error: '', platform: 'darwin',
        }),
      })
    })
    let posts = 0
    await page.route('**/api/v1/parses*', async (route: Route) => {
      if (route.request().method() === 'POST') posts++
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ run_id: 1 }) })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    const confirmBtn = page.locator('[data-reparse-all-confirm]')
    // Confirm stacks above Cancel where the arm button stood: the upper part
    // of "Re-parse all…" is the part Confirm covers.
    await clickTwiceInPlace(page, page.locator('[data-reparse-all-arm]'), async () => {
      await expect(confirmBtn).toBeVisible()
    }, { x: 0.5, y: 0.2 })

    await page.waitForTimeout(300)
    expect(posts).toBe(0)
    await expect(confirmBtn).toBeVisible()
  })

  // The same swap on the most destructive button in the app: "Delete N
  // Records" takes "Clear Database…"'s place.
  test('a double-click on Clear Database… arms it and deletes nothing', async ({ page }) => {
    let deletes = 0
    await page.route(/\/api\/v1\/matches(\?.*)?$/, async (route: Route) => {
      if (route.request().method() === 'DELETE') {
        deletes++
        await route.fulfill({ status: 204 })
        return
      }
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([{
          match_key: 'match-2026-05-01T10-00-00', source_files: ['summary-1.png'],
          source_types: { 'summary-1.png': 'summary' },
          data: { map: 'rialto', playlist: 'competitive', hero: 'lucio', date: '2026-05-01' },
          parsed_at: '2026-05-01T10:00:00Z',
        }]),
      })
    })

    await page.goto('/')
    await page.getByRole('tab', { name: 'Settings' }).click()
    await page.locator('#sec-advanced').evaluate(el => (el as HTMLDetailsElement).open = true)
    const deleteBtn = page.getByRole('button', { name: /^Delete 1 Record/ })
    await clickTwiceInPlace(page, page.getByRole('button', { name: 'Clear Database…' }), async () => {
      await expect(deleteBtn).toBeVisible()
    })

    await page.waitForTimeout(300)
    expect(deletes).toBe(0)
    await expect(deleteBtn).toBeVisible()
  })
})

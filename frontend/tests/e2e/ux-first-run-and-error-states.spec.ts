/**
 * UX polish — first-run hint, step label, parse button copy,
 * error-banner retry. Covers the 1.0 plan §C four S-effort items
 * that are user-visible.
 */
import type { Route } from '@playwright/test'
import { test, expect } from '@playwright/test'

// First-run modal tests need the legacy "ack" flag CLEARED — opposite
// of the shared _fixtures.ts pre-dismiss. Use the raw test here.
test.describe('first-run modal — hint always visible + step label', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.onboardingCompleted', 'true')
        localStorage.removeItem('recall.firstRunAccountNamed')
      } catch (_) { /* localStorage forbidden in sandbox */ }
    })
    await page.route('**/api/v1/profiles', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ active: 'main', profiles: ['main'] }),
      })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/settings/screenshots-folder', async (route: Route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: '' }) })
      }
      return route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/system/screenshots-folder-candidates', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
  })

  test('hint visible on first focus (before any keystroke)', async ({ page }) => {
    await page.goto('/')
    const input = page.locator('#first-run-input')
    await expect(input).toBeFocused()
    // The hint with the grammar rules is rendered immediately, not
    // gated on inputDirty — a first-time user should know the rules
    // before they have to guess.
    const hint = page.locator('#first-run-hint')
    await expect(hint).toBeVisible()
    await expect(hint).toContainText(/a–z.*0–9.*1–40/)
  })

  test('step indicator is a readable "Step 1 of 2" label', async ({ page }) => {
    await page.goto('/')
    const label = page.locator('[data-testid="first-run-step-label"]')
    await expect(label).toBeVisible()
    await expect(label).toHaveText('Step 1 of 2')
  })
})

test.describe('parse button — empty-folder copy + ghost style', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.onboardingCompleted', 'true')
        localStorage.setItem('recall.firstRunAccountNamed', 'true')
      } catch (_) { /* */ }
    })
  })

  test('disabled with "All parsed · nothing new" when count is 0', async ({ page }) => {
    await page.route('**/api/v1/profiles', async (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ active: 'main', profiles: ['main'] }),
    }))
    await page.route('**/api/v1/matches', async (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: '[]',
    }))
    await page.route('**/api/v1/settings/screenshots-folder', async (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ path: '/tmp/ow' }),
    }))
    await page.route('**/api/v1/settings/tesseract', async (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        path: '/opt/homebrew/bin/tesseract',
        found: true, version: '5.3.4', supported: true,
        error: '', platform: 'darwin', default: '/opt/homebrew/bin/tesseract',
      }),
    }))
    await page.route('**/api/v1/screenshots/pending-count', async (r) => r.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify({ count: 0 }),
    }))

    await page.goto('/')
    await page.locator('#tab-ingest').click()
    const btn = page.locator('button.btn.primary.big').filter({ hasText: /All parsed|Run Parse/ })
    await expect(btn).toBeVisible()
    await expect(btn).toBeDisabled()
    await expect(btn).toContainText('All parsed · nothing new')
    await expect(btn).toHaveClass(/ghost/)
  })
})

test.describe('error banner — retry CTA on load failures', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('recall.onboardingCompleted', 'true')
        localStorage.setItem('recall.firstRunAccountNamed', 'true')
      } catch (_) { /* */ }
    })
  })

  test('failing matches load surfaces a Retry button that re-fires GET /matches', async ({ page }) => {
    let calls = 0
    await page.route('**/api/v1/matches', async (route: Route) => {
      calls++
      if (calls === 1) {
        // First call: server returns 500 → load() catches and shows banner.
        return route.fulfill({ status: 500, body: 'stat /Users/x: permission denied' })
      }
      // Second call (after Retry): success.
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.route('**/api/v1/profiles', async (r) => r.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ active: 'main', profiles: ['main'] }),
    }))

    await page.goto('/')
    const banner = page.locator('[data-testid="error-banner"]')
    await expect(banner).toBeVisible()
    // Plain-language translation: the raw "permission denied" was
    // mapped to a CTA, not surfaced verbatim.
    await expect(banner).toContainText(/Cannot access.*read access/i)
    await expect(banner).not.toContainText(/permission denied/i)

    const retry = page.locator('[data-testid="error-retry"]')
    await expect(retry).toBeVisible()
    await retry.click()
    await expect.poll(() => calls).toBeGreaterThanOrEqual(2)
    await expect(banner).toBeHidden()
  })
})

/**
 * Detail-panel lifecycle contract E2E — auto-close on Hide, click-outside on
 * the panel backdrop, and the cheatsheet / lightbox backdrops. Each test owns
 * its own mocks (no shared fixture). Split out of match-detail-panel.spec.ts,
 * which keeps the keyboard-ergonomics block.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

test.describe('match detail panel — contract: auto-close + click-outside', () => {
  // These specs each set up their own mocks because the auto-close
  // tests need to flip the matches list mid-test (Hide flow) and the
  // click-outside tests don't share the rank fixture with the keyboard
  // ergonomics describe block.

  test('hiding the open match auto-closes the panel', async ({ page }) => {
    const KEY_ENCODED = encodeURIComponent('m1')
    let hidden = false
    function rec() {
      return {
        match_key: 'm1',
        source_files: ['m1.png'],
        source_types: { 'm1.png': 'summary' },
        data: { map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
        parsed_at: '2026-05-10T22:30:00Z',
        hidden,
      }
    }
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([rec()]) })
    })
    await page.route(`**/api/v1/matches/${KEY_ENCODED}/visibility`, async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      hidden = !!body.hidden
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Hide → Confirm; the match leaves filteredSorted on the
    // next /api/v1/matches refresh, and useSelectedMatch's auto-close
    // watch fires.
    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()
    await page.locator('.danger-btn', { hasText: 'Confirm' }).click()

    // Panel disappears.
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('click on the dim backdrop closes the panel', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          match_key: 'm1',
          source_files: ['m1.png'],
          source_types: { 'm1.png': 'summary' },
          data: { map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
          parsed_at: '2026-05-10T22:30:00Z',
        }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    // Click on the backdrop at a coordinate that's outside the
    // 540px-wide panel (panel anchors right; click far-left of
    // viewport).
    await page.locator('.detail-backdrop').click({ position: { x: 20, y: 200 } })
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
  })

  test('? on a non-Matches view shows only Global + Tablist (no Matches / Detail-panel sections)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    // Navigate to Settings via the tab — panel + matches groups
    // should drop out of the rendered cheatsheet.
    await page.locator('#tab-settings').click()
    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    const titles = await cheatsheet.locator('.kbd-group-title').allTextContents()
    expect(titles).toContain('Global')
    expect(titles).toContain('Tablist + modals')
    expect(titles).not.toContain('Matches view')
    expect(titles).not.toContain('Detail panel')
  })

  test('cheatsheet backdrop click closes the modal', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.keyboard.press('?')
    const cheatsheet = page.locator('[data-testid="kbd-shortcuts-modal"]')
    await expect(cheatsheet).toBeVisible()

    // The overlay is the cheatsheet's outermost element; the modal
    // box stops propagation on its own click. Tap the overlay near
    // a corner so we miss the centered box.
    await cheatsheet.click({ position: { x: 10, y: 10 } })
    await expect(cheatsheet).toHaveCount(0)
  })

  test('lightbox backdrop click closes the lightbox (panel stays)', async ({ page }) => {
    await page.route('**/_screenshot/**', async (route) => {
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      )
      await route.fulfill({ status: 200, contentType: 'image/png', body: png })
    })
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{
          match_key: 'm1',
          source_files: ['m1.png'],
          source_types: { 'm1.png': 'summary' },
          data: { map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio', result: 'victory', date: '2026-05-10', finished_at: '22:00' },
          parsed_at: '2026-05-10T22:30:00Z',
        }]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    await page.locator('.sources-toggle .sources-label').click()
    await page.locator('.source-name').first().click()
    await page.locator('img.source-preview').first().click()
    await expect(page.locator('.lightbox-backdrop')).toBeVisible()

    // Click the backdrop at the top-right (away from the centered
    // image AND the top-left × button).
    await page.locator('.lightbox-backdrop').click({ position: { x: 780, y: 20 } })
    await expect(page.locator('.lightbox-backdrop')).toHaveCount(0)
    // Panel still up.
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })
})

/**
 * Background scroll-lock for modal overlays.
 *
 * When a modal panel is open (match detail panel, narrow filter panel,
 * …) the page behind it must NOT scroll on the mouse wheel, even when
 * the cursor is off the panel. `inert` on the background blocks
 * focus/click/keyboard but NOT the wheel — useScrollLock freezes the
 * root scroller. Closing restores scrolling at the same position.
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function rec(i: number) {
  const hh = String(23 - Math.floor(i / 4)).padStart(2, '0')
  const mm = String((i % 4) * 15).padStart(2, '0')
  return {
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'lucio',
      result: i % 2 ? 'victory' : 'defeat',
      date: '2026-05-10', finished_at: `${hh}:${mm}`,
      eliminations: 10, assists: 8, deaths: 6,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

// 40 rows so the page is comfortably taller than the viewport.
const CORPUS = Array.from({ length: 40 }, (_, i) => rec(i))

const scrollY = (page: import('@playwright/test').Page) => page.evaluate(() => window.scrollY)

test.describe('modal scroll-lock', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    // < 1400 px so the narrow filter renders as a popover (modal), not
    // the always-present rail; tall enough to exercise the scroll.
    await page.setViewportSize({ width: 1100, height: 720 })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
    // Sanity: the page is actually scrollable.
    const scrollable = await page.evaluate(() => document.documentElement.scrollHeight > window.innerHeight + 50)
    expect(scrollable).toBe(true)
  })

  test('the match detail panel freezes the background; closing restores scrolling', async ({ page }) => {
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()

    const before = await scrollY(page)
    // Wheel over the background (left side; the detail panel slides in
    // from the right).
    await page.mouse.move(150, 380)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeLessThanOrEqual(before + 1)

    await page.keyboard.press('Escape')
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeGreaterThan(before + 50)
  })

  test('the narrow filter panel freezes the background; closing restores scrolling', async ({ page }) => {
    await page.locator('[data-narrow-trigger]').click()
    await expect(page.locator('#narrow-popover')).toBeVisible()

    const before = await scrollY(page)
    // Wheel over the background (right side; the filter panel is on the
    // left).
    await page.mouse.move(860, 380)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeLessThanOrEqual(before + 1)

    // The panel auto-focuses its search input, so the first Esc just
    // deselects that field (mid-filter Esc no longer nukes the panel);
    // a second Esc, focus no longer in a field, closes it.
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.locator('#narrow-popover')).toHaveCount(0)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeGreaterThan(before + 50)
  })

  test('the widget-config (gear) popover freezes the background; it no longer scrolls away', async ({ page }) => {
    // The reported bug: the gear popover scrolled out from under itself.
    const gear = page.locator('[data-widget-config-trigger="top-heroes"]')
    await gear.click()
    await expect(page.getByTestId('widget-config-popover')).toBeVisible()

    const before = await scrollY(page)
    await page.mouse.move(300, 420)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeLessThanOrEqual(before + 1)

    await page.keyboard.press('Escape')
    await expect(page.getByTestId('widget-config-popover')).toHaveCount(0)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeGreaterThan(before + 50)
  })

  test('a dropdown (the dossier Add menu) also freezes the background', async ({ page }) => {
    await page.locator('[data-dossier-add]').click()
    await expect(page.locator('.dossier-manage-panel')).toBeVisible()

    const before = await scrollY(page)
    await page.mouse.move(300, 500)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeLessThanOrEqual(before + 1)

    await page.keyboard.press('Escape')
    await expect(page.locator('.dossier-manage-panel')).toHaveCount(0)
    await page.mouse.wheel(0, 600)
    await page.waitForTimeout(150)
    expect(await scrollY(page)).toBeGreaterThan(before + 50)
  })
})

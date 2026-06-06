/**
 * Matches tab — scroll-to-top + jump-to-undated affordances.
 *
 * Two small navigation buttons added to the Matches workspace:
 *
 *   1. A fixed lower-left "↑" button that fades in once the user is
 *      past ~400 px down the page. Click → smooth scroll to the top
 *      of the document. The visibility gate lives in
 *      `useScrollAffordance`; this spec drives the real browser to
 *      verify the listener actually fires + the button reaches the
 *      DOM with the right ARIA shape.
 *
 *   2. A "↓ N undated" button next to the Cozy / Compact density
 *      toggle in `.leaves-head-controls`. Disabled with an empty-
 *      state tooltip when the current narrow has no undated rows;
 *      enabled with a live count otherwise. Click → smooth scroll
 *      the "No date" section divider into view.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const VIEWPORT_TALLER_THAN_WORKSPACE = 720

// Seed enough rows that the leaves list is taller than the
// viewport, otherwise window.scrollY can't cross the 400 px gate.
// 60 dated rows at ~50 px per row = 3000 px of list, plus the
// dossier + campaign log above ≈ 3500 px total scroll height.
function datedRecords(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    match_key: `dated-${i}`,
    source_files: [`d${i}.png`],
    source_types: { [`d${i}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: i % 2 === 0 ? 'victory' : 'defeat',
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      finished_at: '22:00',
      eliminations: 10, assists: 5, deaths: 3,
    },
    parsed_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T22:30:00Z`,
  }))
}

function undatedRecords(n: number): Record<string, unknown>[] {
  return Array.from({ length: n }, (_, i) => ({
    match_key: `undated-${i}`,
    source_files: [`u${i}.png`],
    source_types: { [`u${i}.png`]: 'summary' },
    // No `date` → useMatchesGroup buckets these under "No date".
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', finished_at: '22:00',
      eliminations: 10, assists: 5, deaths: 3,
    },
    parsed_at: `2026-05-15T22:30:00Z`,
  }))
}

test.describe('Matches — scroll affordances', () => {
  test.beforeEach(async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width: 1280, height: VIEWPORT_TALLER_THAN_WORKSPACE })
  })

  test('scroll-to-top: hidden at top, visible past ~400 px, click resets to 0', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(datedRecords(60)),
      })
    })
    await page.goto('/')
    // Default landing is Matches; no explicit click needed, but
    // assert the panel is mounted before reading the button state.
    await expect(page.locator('#panel-matches')).toBeVisible()

    const btn = page.locator('[data-scroll-to-top]')
    await expect(btn).toHaveCount(0)

    await page.evaluate(() => window.scrollTo(0, 800))
    // Give the rAF-coalesced listener a frame to flip the state.
    await page.waitForTimeout(60)
    await expect(btn).toBeVisible()
    await expect(btn).toHaveAttribute('aria-label', 'Scroll to top of page')

    await btn.click()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    // Below threshold → button fades out again.
    await expect(btn).toHaveCount(0)
  })

  test('jump-to-undated: button reflects live undated count and scrolls the "No date" section into view', async ({ page }) => {
    // Keep the total at <= 20 so the infinite-scroll windowing
    // (DEFAULT_PAGE_SIZE = 20) renders the entire corpus in one
    // page — including the trailing "No date" section divider.
    // Window height is taller than 20 leaf rows + dossier, so the
    // divider still requires a scroll to reach naturally.
    const corpus = [...datedRecords(12), ...undatedRecords(5)]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(corpus),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    const btn = page.locator('[data-jump-to-undated]')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('5 undated')
    await expect(btn).toBeEnabled()

    const divider = page.locator('[data-section-key="no-date"]')
    await expect(divider).toHaveCount(1)

    await btn.click()
    await expect(divider).toBeInViewport({ ratio: 0.5 })
  })

  test('jump-to-undated: expands the infinite-scroll window so the "No date" section reaches the DOM even past the first page', async ({ page }) => {
    // Pre-fix: useMatchesWindow rendered only the first 20 rows
    // on mount; with 60+ records, the trailing "No date" section
    // was never in the DOM when `document.querySelector` ran, so
    // the jump silently did nothing. The handler now calls
    // expandWindowToAll() + awaits a tick before querying.
    const corpus = [...datedRecords(60), ...undatedRecords(8)]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(corpus),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    // Initially the leaves list is windowed at 20 rows — the
    // "No date" divider is NOT in the DOM yet.
    await expect(page.locator('[data-section-key="no-date"]')).toHaveCount(0)

    const btn = page.locator('[data-jump-to-undated]')
    await expect(btn).toContainText('8 undated')
    await btn.click()

    const divider = page.locator('[data-section-key="no-date"]')
    await expect(divider).toHaveCount(1)
    await expect(divider).toBeInViewport({ ratio: 0.5 })
  })

  test('jump-to-undated: disabled with empty-state tooltip when no undated matches exist', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(datedRecords(10)),
      })
    })
    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    const btn = page.locator('[data-jump-to-undated]')
    await expect(btn).toBeVisible()
    await expect(btn).toContainText('0 undated')
    await expect(btn).toBeDisabled()
    await expect(btn).toHaveAttribute('title', 'No undated matches in this view')
  })
})

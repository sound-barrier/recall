/**
 * Sticky Campaign Log on the Matches tab.
 *
 * When the user scrolls past the natural position of the timeline,
 * the wrapper pins to the top edge of the viewport and the timeline
 * itself drops into compact mode (heatmap hidden, window-size
 * buttons hidden, sparkline at compact height).
 *
 * The mode flip is driven by an IntersectionObserver on a 1 px
 * sentinel that sits just above the wrapper. Once the sentinel
 * scrolls out of the viewport, `timelineSticky` flips true and
 * the timeline gets the `match-timeline-compact` class.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function makeMatches(): Record<string, unknown>[] {
  // Need enough rows that the leaves list is taller than the
  // viewport — otherwise there's nothing to scroll into. 60 rows
  // at ~50 px each = 3000 px of list well beyond 720 px viewport.
  return Array.from({ length: 60 }, (_, i) => ({
    match_key: `m${i}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto',
      mode: 'competitive',
      type: 'control',
      role: 'support',
      hero: 'lucio',
      result: i % 2 === 0 ? 'victory' : 'defeat',
      date: `2026-05-${String((i % 28) + 1).padStart(2, '0')}`,
      finished_at: '22:00',
      eliminations: 10, assists: 5, deaths: 3,
    },
    parsed_at: `2026-05-${String((i % 28) + 1).padStart(2, '0')}T22:30:00Z`,
  }))
}

test.describe('Matches — sticky Campaign Log', () => {
  test('timeline pins + flips to compact mode after scrolling past it', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(makeMatches()),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Before scrolling: timeline is at its natural position. The
    // heatmap is in the DOM (expanded mode).
    const timeline = page.locator('.match-timeline').first()
    await expect(timeline).toBeVisible()
    await expect(timeline).not.toHaveClass(/match-timeline-compact/)
    // The heatmap header is the visible signal of expanded mode.
    await expect(page.locator('.match-heatmap').first()).toBeVisible()

    // Scroll far enough that the sentinel above the timeline leaves
    // the viewport. The dossier widget grid sits above the timeline,
    // so 1200 px of scroll is well past it.
    await page.evaluate(() => window.scrollTo(0, 1500))

    // Compact class applies + heatmap hides.
    await expect(timeline).toHaveClass(/match-timeline-compact/)
    await expect(page.locator('.match-heatmap')).toHaveCount(0)
  })

  test('scrolling back to top restores the expanded timeline', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(makeMatches()),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    const timeline = page.locator('.match-timeline').first()

    await page.evaluate(() => window.scrollTo(0, 1500))
    await expect(timeline).toHaveClass(/match-timeline-compact/)

    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(timeline).not.toHaveClass(/match-timeline-compact/)
    await expect(page.locator('.match-heatmap').first()).toBeVisible()
  })
})

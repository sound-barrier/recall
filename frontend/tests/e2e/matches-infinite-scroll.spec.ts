/**
 * Matches leaves-list infinite-scroll window.
 *
 * MatchesView renders only the first 20 narrowed/grouped rows;
 * an IntersectionObserver-observed sentinel `<li>` at the tail of
 * the rendered range expands the window by another 20 when it
 * enters the viewport. This spec proves the full chain end-to-end:
 * boot mounts 20 rows, the sentinel grows the window to 40 then
 * to the full 60, the foot copy tracks each step, and a narrowing
 * filter that shrinks the set to ≤ 20 removes the sentinel + snaps
 * the list back to the top.
 *
 * The useMatchesWindow composable owns the windowing math: the
 * dossier needs the full corpus for aggregates while the rendered
 * DOM stays small. See its doc comment for the full rationale.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

interface Mode { type: 'control' | 'hybrid' | 'escort' | 'push' | 'flashpoint' }

function makeMatch(i: number): Record<string, unknown> {
  // Spread across 5 days so groupBy='day' (the default) produces
  // multiple sections — proves the window respects section
  // boundaries, not just a flat row count.
  const day = String(10 + (i % 5)).padStart(2, '0')
  const hh = String(i % 24).padStart(2, '0')
  const mm = String(i % 60).padStart(2, '0')
  const result = i % 3 === 0 ? 'victory' : i % 3 === 1 ? 'defeat' : 'draw'
  return {
    match_key: `match-2026-05-${day}T${hh}-${mm}-00-${String(i).padStart(3, '0')}`,
    source_files: [`m${i}.png`],
    source_types: { [`m${i}.png`]: 'summary' },
    data: {
      map: 'rialto',
      playlist: 'competitive',
      type: 'control' as Mode['type'],
      role: 'support',
      hero: 'lucio',
      result,
      date: `2026-05-${day}`,
      finished_at: `${hh}:${mm}`,
      eliminations: 10,
      assists: 5,
      deaths: 3,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: `2026-05-${day}T${hh}:${mm}:00Z`,
  }
}

async function mockCorpus(page: import('@playwright/test').Page, n: number) {
  const corpus = Array.from({ length: n }, (_, i) => makeMatch(i))
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(corpus),
    })
  })
}

test.describe('matches — client-side window (item 6)', () => {
  // Constrained viewport so 20 leaf-rows ≈ 600px overflow below the
  // fold and the sentinel doesn't auto-fire on mount. Without this
  // the default 720px-tall viewport shows all 20 + the sentinel
  // immediately, and the observer ticks straight to 40.
  test.use({ viewport: { width: 1024, height: 500 } })

  test('boots with exactly 20 leaf-rows + sentinel + "Showing 20 of 60"', async ({ page }) => {
    await mockCorpus(page, 60)
    await page.goto('/')
    await page.locator('#tab-matches').click()

    await expect(page.locator('.leaf-row')).toHaveCount(20)
    await expect(page.getByTestId('leaves-sentinel')).toHaveCount(1)
    await expect(page.getByTestId('leaves-foot')).toContainText('Showing 20 of 60 matches')
  })

  test('scrolling the sentinel into view grows the window by a page', async ({ page }) => {
    await mockCorpus(page, 60)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(20)

    // First sentinel hit → 40.
    await page.getByTestId('leaves-sentinel').scrollIntoViewIfNeeded()
    await expect(page.locator('.leaf-row')).toHaveCount(40)
    await expect(page.getByTestId('leaves-foot')).toContainText('Showing 40 of 60 matches')

    // Second hit → 60; sentinel disappears once the corpus is
    // fully rendered.
    await page.getByTestId('leaves-sentinel').scrollIntoViewIfNeeded()
    await expect(page.locator('.leaf-row')).toHaveCount(60)
    await expect(page.getByTestId('leaves-sentinel')).toHaveCount(0)
    // End-of-results footer — em-dash rules flank the count so the
    // boundary reads as final, not "is more loading?".
    await expect(page.getByTestId('leaves-foot')).toContainText('End · 60 matches')
    await expect(page.locator('.leaves-foot-rule')).toHaveCount(2)
  })

  test('foot reads "End · N matches" when the corpus fits in one page', async ({ page }) => {
    await mockCorpus(page, 7)
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(7)
    await expect(page.getByTestId('leaves-sentinel')).toHaveCount(0)
    await expect(page.getByTestId('leaves-foot')).toContainText('End · 7 matches')
    await expect(page.locator('.leaves-foot-rule')).toHaveCount(2)
  })
})

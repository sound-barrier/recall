/**
 * Leaf-row virtualization (UI_RECOMMENDATIONS item 1).
 *
 * When the user picks groupBy='none', the leaves list is one flat
 * stack of uniform-height rows. Recall virtualizes the stack: only
 * the in-viewport slice (plus an overscan band) is in the DOM;
 * spacer divs hold the scrollbar in place so the document still
 * scrolls through every row.
 *
 * Spec covers:
 *   - DOM contains only the visible slice — sub-60 leaf-rows for a
 *     1000-record fixture.
 *   - Scrolling the page updates the rendered slice (the row at
 *     position 500 mounts when the user scrolls to it).
 *   - Clicking a virtualized row still opens the detail panel.
 *   - Grouped modes (default 'day') render every record's row as
 *     today — the grouped path is untouched.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

// Build a 1000-record fixture. Each record carries enough fields
// that the leaf-row template doesn't hit a `?? '—'` fallback (those
// kick a couple extra DOM nodes per row that we'd rather not count
// against the virtualizer's correctness).
function record(i: number) {
  return {
    match_key:    `m-${String(i).padStart(4, '0')}`,
    source_files: [`s-${i}.png`],
    source_types: { [`s-${i}.png`]: 'summary' },
    data: {
      map:    'ilios',
      hero:   'lucio',
      result: i % 2 === 0 ? 'victory' : 'defeat',
      date:   '2026-05-10',
      finished_at: `12:${String(i % 60).padStart(2, '0')}`,
      mode:   'competitive',
      eliminations: 10, assists: 12, deaths: 5,
      heroes_played: [{ hero: 'lucio', play_time: '10:00', percent_played: 100 }],
    },
    parsed_at: `2026-05-10T14:${String(i % 60).padStart(2, '0')}:00Z`,
  }
}

const CORPUS = Array.from({ length: 1000 }, (_, i) => record(i))

test.describe('Matches — leaf-row virtualization', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
  })

  test('flat groupBy=none renders only the in-viewport slice (under 60 leaf-rows)', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
    // Open the toolbar group menu + pick "None". The group menu
    // sits inside `.leaves-toolbar` per the existing template; we
    // find it by the label text "Group" which is stable across
    // visual refreshes.
    const groupTrigger = page.getByRole('button', { name: /group/i }).first()
    await groupTrigger.click()
    await page.getByRole('option', { name: /^none$/i }).click()
    // Wait for the spacer to surface — that's the virtualization
    // signal (groupBy='day' has no spacers).
    await expect(page.locator('[data-virt-bottom-spacer]')).toBeVisible()
    // DOM-row count should be small. With overscan 8 + a 600-ish
    // viewport / 58-px rows = ~10 visible + 16 overscan = ~26 rows,
    // and the upper bound for safety is 60.
    const count = await page.locator('.leaf-row').count()
    expect(count).toBeLessThan(60)
    expect(count).toBeGreaterThan(0)
  })

  test('scrolling reveals rows further down the corpus', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const groupTrigger = page.getByRole('button', { name: /group/i }).first()
    await groupTrigger.click()
    await page.getByRole('option', { name: /^none$/i }).click()
    await expect(page.locator('[data-virt-bottom-spacer]')).toBeVisible()
    // Initially, the row with match_key m-0500 is not in the DOM.
    await expect(page.locator('.leaf-row[data-match-key="m-0500"]')).toHaveCount(0)
    // Scroll partway through the corpus. The list is roughly
    // 1000 × 58 = 58_000 px tall; scrolling 25_000 px lands us
    // somewhere around index 430.
    await page.evaluate(() => window.scrollTo({ top: 25_000, behavior: 'auto' }))
    // The leaf-row at index ~430 should now be in the DOM.
    await expect(page.locator('.leaf-row[data-match-key="m-0430"]')).toBeVisible({ timeout: 5000 })
  })

  test('clicking a virtualized row opens the detail panel', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    const groupTrigger = page.getByRole('button', { name: /group/i }).first()
    await groupTrigger.click()
    await page.getByRole('option', { name: /^none$/i }).click()
    await expect(page.locator('[data-virt-bottom-spacer]')).toBeVisible()
    // Click the first visible row.
    const firstRow = page.locator('.leaf-row').first()
    await firstRow.click()
    // Detail panel mounts on the right.
    await expect(page.locator('aside.detail-panel')).toBeVisible()
  })

  test('grouped mode (default) renders every row in view — no virtualization spacers', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.set-dossier')).toBeVisible()
    // Default groupBy is 'day' — no virtualization in PR scope.
    await expect(page.locator('[data-virt-top-spacer]')).toHaveCount(0)
    await expect(page.locator('[data-virt-bottom-spacer]')).toHaveCount(0)
    // Section dividers surface for grouped mode.
    await expect(page.locator('.section-divider').first()).toBeVisible()
  })
})

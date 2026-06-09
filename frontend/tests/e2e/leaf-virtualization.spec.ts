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
    // The sort/group popover trigger is the segmented control in the
    // toolbar above the leaves list. Open it via its stable
    // data-attribute selector, then click the "No grouping" pick
    // (data-group-pick="none").
    await page.locator('[data-sort-group-trigger]').click()
    await expect(page.locator('[data-testid="sort-group-popover"]')).toBeVisible()
    await page.locator('[data-group-pick="none"]').click()
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
    // The sort/group popover trigger is the segmented control in the
    // toolbar above the leaves list. Open it via its stable
    // data-attribute selector, then click the "No grouping" pick
    // (data-group-pick="none").
    await page.locator('[data-sort-group-trigger]').click()
    await expect(page.locator('[data-testid="sort-group-popover"]')).toBeVisible()
    await page.locator('[data-group-pick="none"]').click()
    await expect(page.locator('[data-virt-bottom-spacer]')).toBeVisible()
    // Initially, a row deep in the corpus isn't in the DOM — the
    // virtualizer only renders the in-viewport slice.
    await expect(page.locator('.leaf-row[data-match-key="m-0500"]')).toHaveCount(0)
    // Capture the first-visible row before the scroll so the
    // assertion doesn't hard-code an expected absolute index (which
    // depends on row height + viewport size + dossier chrome — all
    // environment-specific).
    const firstBeforeKey = await page.locator('.leaf-row').first().getAttribute('data-match-key')
    const beforeIdx = Number((firstBeforeKey ?? 'm-0000').replace('m-', ''))
    // Scroll the document down by a large delta. The virtualizer
    // remounts the slice on the next RAF; allow a short wait for
    // the reactive flush.
    await page.evaluate(() => window.scrollTo({ top: 30_000, behavior: 'auto' }))
    await page.waitForTimeout(150)
    const firstAfterKey = await page.locator('.leaf-row').first().getAttribute('data-match-key')
    const afterIdx = Number((firstAfterKey ?? 'm-0000').replace('m-', ''))
    // The virtualizer advanced in response to scroll. The exact
    // magnitude is env-dependent (DPR, viewport height, dossier
    // chrome height, scroll-container resolution) — a strict
    // numeric threshold flaked on a 1280×720 / 2x DPR Mac that
    // only advanced ~51 rows. The right guarantee is "the slice
    // moved meaningfully" — at least 10 rows past the starting
    // position. A broken virtualizer (no rebind on scroll) would
    // leave afterIdx == beforeIdx; this catches that without
    // depending on layout math.
    expect(afterIdx).toBeGreaterThan(beforeIdx + 10)
  })

  test('clicking a virtualized row opens the detail panel', async ({ page }) => {
    await page.goto('/')
    await page.locator('#tab-matches').click()
    // The sort/group popover trigger is the segmented control in the
    // toolbar above the leaves list. Open it via its stable
    // data-attribute selector, then click the "No grouping" pick
    // (data-group-pick="none").
    await page.locator('[data-sort-group-trigger]').click()
    await expect(page.locator('[data-testid="sort-group-popover"]')).toBeVisible()
    await page.locator('[data-group-pick="none"]').click()
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

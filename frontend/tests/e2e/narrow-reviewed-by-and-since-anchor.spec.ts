/**
 * Two related narrow-panel filters:
 *
 *   1. Reviewed-by: multi-select OR over {Self, Coach, Unreviewed}.
 *      Empty = no filter; toggles compose, so "Self + Coach" surfaces
 *      every reviewed match regardless of who reviewed it.
 *
 *   2. Since this match: a per-user "anchor" the user stamps on a
 *      single match via the detail panel. The narrow panel exposes
 *      a toggle "Only matches after {anchor}" that drops anything
 *      with a parsed_at on or before the anchor.
 *
 * These ship together because they target the same use case — a
 * coach (or the user themselves) reviewing the dossier after a
 * coaching session: "since my last review, am I improving?"
 */
import { test, expect } from './_fixtures'
import type { Route } from '@playwright/test'

function match(key: string, parsedAt: string, reviewedBy?: 'self' | 'coach') {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    source_types: { [`${key}.png`]: 'summary' },
    data: {
      map: 'rialto', mode: 'competitive', type: 'control',
      role: 'support', hero: 'lucio',
      result: 'victory', date: parsedAt.slice(0, 10), finished_at: '22:00',
      eliminations: 17, assists: 16, deaths: 11,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: parsedAt,
    ...(reviewedBy ? { reviewed_by: reviewedBy } : {}),
  }
}

const CORPUS = [
  match('d1-self',     '2026-05-01T12:00:00Z', 'self'),
  match('d2-coach',    '2026-05-02T12:00:00Z', 'coach'),
  match('d3-anchor',   '2026-05-03T12:00:00Z'),
  match('d4-unrevwd',  '2026-05-04T12:00:00Z'),
  match('d5-self',     '2026-05-05T12:00:00Z', 'self'),
]

test.describe('narrow panel — reviewed-by + since-anchor', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify(CORPUS),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    // Clear any leftover anchor from previous specs so the
    // "no anchor" branch in the narrow panel is observable.
    await page.evaluate(() => localStorage.removeItem('recall.matches.sinceAnchor'))
    await page.reload()
    await page.locator('#tab-matches').click()
  })

  async function openNarrow(page: import('@playwright/test').Page) {
    await page.locator('[data-narrow-trigger]').click()
  }

  test('reviewed-by chips: picking "Self" surfaces only self-reviewed matches', async ({ page }) => {
    await openNarrow(page)
    await page.locator('[data-reviewed-by="self"]').click()
    // Footer status tracks the post-narrow count: 2 self-reviewed.
    await expect(page.locator('.np-foot-status')).toContainText('2 matches')
    // The active-chip strip shows the reviewed-by pick.
    await expect(page.locator('.active-chip:not(.clear)').first()).toContainText('Reviewed by')
    await expect(page.locator('.active-chip:not(.clear)').first()).toContainText('self')
  })

  test('reviewed-by chips compose as OR across self + coach', async ({ page }) => {
    await openNarrow(page)
    await page.locator('[data-reviewed-by="self"]').click()
    await page.locator('[data-reviewed-by="coach"]').click()
    // 2 self + 1 coach = 3.
    await expect(page.locator('.np-foot-status')).toContainText('3 matches')
  })

  test('reviewed-by "Unreviewed" surfaces only matches without a review row', async ({ page }) => {
    await openNarrow(page)
    await page.locator('[data-reviewed-by="unreviewed"]').click()
    // d3-anchor and d4-unrevwd.
    await expect(page.locator('.np-foot-status')).toContainText('2 matches')
  })

  test('since-anchor: empty state shows the prompt; toggle is absent', async ({ page }) => {
    await openNarrow(page)
    // Empty-state copy points users at the detail-panel affordance.
    await expect(page.locator('text=Open a match')).toBeVisible()
    // The toggle isn't rendered because no anchor is set.
    await expect(page.locator('[data-since-anchor-toggle]')).toHaveCount(0)
  })

  test('setting an anchor from the detail panel enables the since-anchor filter', async ({ page }) => {
    // Open the third match (the one we plan to anchor on).
    await page.locator('[data-match-key="d3-anchor"]').click()
    // The detail panel's anchor button starts idle (not the anchor).
    const anchorBtn = page.locator('[data-set-anchor]')
    await expect(anchorBtn).toBeVisible()
    await expect(anchorBtn).not.toHaveClass(/is-anchor/)
    // Stamp the anchor.
    await anchorBtn.click()
    await expect(anchorBtn).toHaveClass(/is-anchor/)

    // Close the detail panel via Escape so the narrow panel can open.
    await page.keyboard.press('Escape')

    // Open the narrow panel — the since-anchor section now shows
    // the toggle + anchor's date label.
    await openNarrow(page)
    const toggle = page.locator('[data-since-anchor-toggle]')
    await expect(toggle).toBeVisible()
    await expect(page.locator('[data-since-anchor-label]')).toContainText('2026-05-03')

    // Flip the toggle — only the two POST-anchor matches survive.
    await toggle.check()
    await expect(page.locator('.np-foot-status')).toContainText('2 matches')

    // Active-chip surfaces the active filter with the anchor's date.
    await expect(page.locator('.active-chip:not(.clear)').first()).toContainText('Since')
    await expect(page.locator('.active-chip:not(.clear)').first()).toContainText('2026-05-03')
  })

  test('list view shows a diamond pin + accent stripe on the anchor row', async ({ page }) => {
    // Stamp the anchor on d3.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.keyboard.press('Escape')

    // Only the anchor row carries the `.is-anchor` class AND a
    // visible pin glyph. Other rows have neither — verifies that
    // the indicator scales with the anchor identity, not all rows.
    const anchorRow = page.locator('.leaf-row[data-match-key="d3-anchor"]')
    await expect(anchorRow).toHaveClass(/is-anchor/)
    await expect(anchorRow.locator('[data-leaf-anchor-pin]')).toBeVisible()

    const otherRow = page.locator('.leaf-row[data-match-key="d1-self"]')
    await expect(otherRow).not.toHaveClass(/is-anchor/)
    await expect(otherRow.locator('[data-leaf-anchor-pin]')).toHaveCount(0)

    // After clearing, the indicator disappears.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.keyboard.press('Escape')
    await expect(anchorRow).not.toHaveClass(/is-anchor/)
    await expect(anchorRow.locator('[data-leaf-anchor-pin]')).toHaveCount(0)
  })

  test('narrow panel "↗ open" shortcut closes the panel + opens the anchor', async ({ page }) => {
    // Set the anchor.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.keyboard.press('Escape')

    // Open narrow panel and verify the open shortcut is wired.
    await openNarrow(page)
    const openBtn = page.locator('[data-since-anchor-open]')
    await expect(openBtn).toBeVisible()
    await openBtn.click()

    // Narrow panel closed, detail panel for the anchor opens.
    await expect(page.locator('#narrow-popover')).toHaveCount(0)
    // The detail panel renders the anchor button in the active state.
    await expect(page.locator('[data-set-anchor]')).toHaveClass(/is-anchor/)
  })

  test('confirmation toast fires on set with the match label + "View filter" action', async ({ page }) => {
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()

    const toast = page.locator('[data-anchor-toast]')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/reference set/i)
    await expect(toast).toContainText('2026-05-03')
    // The "View filter" action opens the narrow panel.
    await page.keyboard.press('Escape')
    await page.locator('[data-anchor-toast-view]').click()
    await expect(page.locator('#narrow-popover')).toBeVisible()
  })

  test('confirmation toast fires on clear with the cleared-state copy', async ({ page }) => {
    // Set then immediately clear.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.locator('[data-set-anchor]').click()
    const toast = page.locator('[data-anchor-toast]')
    await expect(toast).toBeVisible()
    await expect(toast).toContainText(/reference cleared/i)
    // No "View filter" action when cleared — the affordance only
    // makes sense when there IS a filter to view.
    await expect(toast.locator('[data-anchor-toast-view]')).toHaveCount(0)
  })

  test('right-click a list row → context menu offers Filter from this match', async ({ page }) => {
    const row = page.locator('.leaf-row[data-match-key="d4-unrevwd"]')
    await row.click({ button: 'right' })
    const menu = page.locator('[data-row-ctx]')
    await expect(menu).toBeVisible()
    await expect(menu).toContainText(/filter from this match/i)
    // Clicking the anchor item stamps the anchor + dismisses the menu.
    await page.locator('[data-row-ctx-anchor]').click()
    await expect(menu).toHaveCount(0)
    // The row now wears the anchor class.
    await expect(row).toHaveClass(/is-anchor/)
  })

  test('right-clicking the anchor row offers Clear since-anchor', async ({ page }) => {
    // Set anchor on d3 first via the detail panel.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.keyboard.press('Escape')
    // Right-click the anchor row.
    await page.locator('.leaf-row[data-match-key="d3-anchor"]').click({ button: 'right' })
    const menu = page.locator('[data-row-ctx]')
    await expect(menu).toContainText(/clear.*anchor/i)
    // Click the anchor item → cleared.
    await page.locator('[data-row-ctx-anchor]').click()
    await expect(page.locator('.leaf-row[data-match-key="d3-anchor"]')).not.toHaveClass(/is-anchor/)
  })

  test('Clear anchor button in the narrow panel persists across reloads', async ({ page }) => {
    // Set the anchor.
    await page.locator('[data-match-key="d3-anchor"]').click()
    await page.locator('[data-set-anchor]').click()
    await page.keyboard.press('Escape')

    // Open narrow + clear via the section's Clear button.
    await openNarrow(page)
    await page.locator('[data-since-anchor-clear]').click()

    // Empty-state returns; toggle disappears.
    await expect(page.locator('text=Open a match')).toBeVisible()
    await expect(page.locator('[data-since-anchor-toggle]')).toHaveCount(0)

    // localStorage was cleared too.
    const stored = await page.evaluate(() => localStorage.getItem('recall.matches.sinceAnchor'))
    expect(stored).toBe('')
  })
})

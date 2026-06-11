/**
 * Contextual multi-select + Hidden drawer + bulk archive ops E2E.
 *
 * Drives the full feature contract end-to-end through the real
 * browser:
 *   1. Three visible matches load with low-opacity checkboxes on
 *      every row (no mode toggle).
 *   2. User ticks two rows → action bar appears with "2 selected ·
 *      Select all (3) · Hide · Clear".
 *   3. Select all flips to 3 — the Select all button hides.
 *   4. Clicking Hide fires PUT /visibility (hidden:true) for each
 *      ticked key; the leaves list collapses to zero matches and
 *      the Hidden drawer count reads "3".
 *   5. Expand the drawer; the archive rows also expose checkboxes.
 *      Tick all three via the archive Select all and click Unhide
 *      → three PUT /visibility (hidden:false) calls fire.
 *   6. With everything visible again, hide one row and confirm bulk
 *      Delete forever from the archive's two-step confirm — the
 *      DELETE /api/v1/matches/{key} call fires.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEYS = [
  'match-2026-05-10T22-00-00',
  'match-2026-05-10T22-30-00',
  'match-2026-05-10T23-00-00',
] as const

const HEROES = ['lucio', 'ana', 'mercy'] as const

function record(i: number, hidden: boolean) {
  return {
    match_key: KEYS[i],
    source_files: [`${KEYS[i]}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      type: 'control',
      role: 'support',
      hero: HEROES[i],
      result: 'victory',
      date: '2026-05-10',
      finished_at: ['22:00', '22:30', '23:00'][i],
      eliminations: 10 + i,
      assists: 5,
      deaths: 3,
      damage: 5000,
      heroes_played: [{ hero: HEROES[i], percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T23:30:00Z',
    ...(hidden ? { hidden: true } : {}),
  }
}

test.describe('matches — contextual multi-select + Archive bulk ops', () => {
  test('select all → bulk hide → bulk unhide → bulk delete forever', async ({ page }) => {
    const hiddenKeys = new Set<string>()
    const deletedKeys = new Set<string>()
    const deleteCalls: string[] = []
    const visibilityCalls: { key: string; hidden: boolean }[] = []

    await page.route('**/api/v1/matches', async (route: Route) => {
      const records = KEYS
        .filter((k) => !deletedKeys.has(k))
        .map((_, i) => record(i, hiddenKeys.has(KEYS[i]!)))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })
    await page.route('**/api/v1/matches/*/visibility', async (route: Route) => {
      const url = new URL(route.request().url())
      const segs = url.pathname.split('/')
      const matchKey = decodeURIComponent(segs[segs.length - 2] ?? '')
      const body = JSON.parse(route.request().postData() ?? '{}') as { hidden?: boolean }
      visibilityCalls.push({ key: matchKey, hidden: !!body.hidden })
      if (body.hidden) hiddenKeys.add(matchKey)
      else hiddenKeys.delete(matchKey)
      await route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/matches/*', async (route: Route, request) => {
      if (request.method() !== 'DELETE') {
        await route.fallback()
        return
      }
      const url = new URL(request.url())
      const segs = url.pathname.split('/')
      const matchKey = decodeURIComponent(segs[segs.length - 1] ?? '')
      deleteCalls.push(matchKey)
      deletedKeys.add(matchKey)
      hiddenKeys.delete(matchKey)
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(3)

    // ── Contextual selection: checkboxes are always present (no toggle).
    await expect(page.locator('.bulk-select-toggle')).toHaveCount(0)
    await expect(page.locator('.leaf-row .leaf-checkbox')).toHaveCount(3)
    await expect(page.locator('.bulk-action-bar')).toHaveCount(0)

    // Tick two rows — action bar surfaces with Select all.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.locator('.leaf-row').nth(1).locator('.leaf-checkbox').click()
    await expect(page.locator('.bulk-action-bar')).toContainText('2 selected')
    await expect(page.locator('.bulk-action-bar .bulk-select-all')).toContainText('Select all (3)')

    // Use Select all to flip the third row in too.
    await page.locator('.bulk-action-bar .bulk-select-all').click()
    await expect(page.locator('.bulk-action-bar')).toContainText('3 selected')
    // When everything visible is ticked, Select all disappears.
    await expect(page.locator('.bulk-action-bar .bulk-select-all')).toHaveCount(0)
    await expect(page.locator('.leaf-row.is-ticked')).toHaveCount(3)

    // Hide all three.
    await page.locator('.bulk-action-bar .bulk-hide').click()
    await expect.poll(() => visibilityCalls.length).toBeGreaterThanOrEqual(3)
    expect(visibilityCalls.every((c) => c.hidden === true)).toBe(true)
    await expect(page.locator('.leaf-row')).toHaveCount(0)

    // Drawer count reads 3.
    const drawerToggle = page.locator('.archive-toggle')
    await expect(drawerToggle).toContainText('3')
    await drawerToggle.click()
    await expect(page.locator('.archive-row')).toHaveCount(3)
    await expect(page.locator('.archive-row .archive-checkbox')).toHaveCount(3)

    // ── Archive bulk Unhide via Select all.
    await page.locator('.archive-row').nth(0).locator('.archive-checkbox').click()
    await expect(page.locator('.archive-action-bar')).toContainText('1 selected')
    await page.locator('.archive-action-bar .bulk-select-all').click()
    await expect(page.locator('.archive-action-bar')).toContainText('3 selected')

    await page.locator('.archive-action-bar .bulk-unhide').click()
    await expect.poll(() => visibilityCalls.filter((c) => c.hidden === false).length).toBeGreaterThanOrEqual(3)
    await expect(page.locator('.leaf-row')).toHaveCount(3)
    // Archive section gone (nothing hidden, drawer state cleared by re-render).
    await expect(page.locator('.archive-row')).toHaveCount(0)

    // ── Bulk Delete forever — hide one, then archive-bulk-delete it.
    // Drawer state survives the empty-then-refilled transition, so
    // it's already expanded from the unhide step above. Wait for the
    // new archive row to render before ticking it.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.locator('.bulk-action-bar .bulk-hide').click()
    await expect(page.locator('.archive-toggle')).toContainText('1')
    await expect(page.locator('.archive-row')).toHaveCount(1)

    await page.locator('.archive-row').nth(0).locator('.archive-checkbox').click()
    await page.locator('.archive-action-bar .bulk-delete').click()
    // Two-step inline confirm on the action bar.
    await expect(page.locator('.bab-warn-text')).toContainText('Delete 1 match from the database')
    await expect(page.locator('.archive-action-bar .bulk-confirm')).toBeVisible()

    await page.locator('.archive-action-bar .bulk-confirm').click()
    await expect.poll(() => deleteCalls.length).toBeGreaterThanOrEqual(1)
    expect(deleteCalls.length).toBe(1)
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })

  test('row body click still opens the detail panel even while a selection exists', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(0, false), record(1, false)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)

    // Tick row 0 — action bar appears.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await expect(page.locator('.bulk-action-bar')).toContainText('1 selected')

    // Click row 1's body (NOT the checkbox) — detail panel opens,
    // and the row should NOT have been ticked.
    await page.locator('.leaf-row').nth(1).locator('.leaf-map-block').click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(page.locator('.leaf-row.is-ticked')).toHaveCount(1)
  })
})

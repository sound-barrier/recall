/**
 * Bulk-hide + Hidden drawer + hard-delete E2E.
 *
 * Drives the full feature contract:
 *   1. Three visible matches load.
 *   2. User clicks "Select" in the upper right → checkboxes appear.
 *   3. User ticks two rows → action bar shows "2 selected · Hide ·
 *      Cancel". Hide fires PUT /visibility (hidden:true) for each
 *      ticked key; rows vanish from the leaves list.
 *   4. Hidden drawer header shows count "2"; expand reveals the two
 *      archived rows. Stats dossier excludes hidden — leaves count
 *      becomes 1.
 *   5. Unhide a drawer row → PUT /visibility (hidden:false) for that
 *      key; the row re-appears in the leaves list.
 *   6. On the last drawer row click "Delete forever" → confirm step
 *      appears; click "Confirm" → DELETE /api/v1/matches/{key} fires;
 *      drawer empties.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEYS = [
  'match:2026-05-10T22:00:00',
  'match:2026-05-10T22:30:00',
  'match:2026-05-10T23:00:00',
] as const

const HEROES = ['lucio', 'ana', 'mercy'] as const

function record(i: number, hidden: boolean) {
  return {
    match_key: KEYS[i],
    source_files: [`${KEYS[i]}.png`],
    data: {
      map: 'rialto',
      mode: 'competitive',
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

test.describe('matches — bulk hide + Hidden drawer + delete forever', () => {
  test('select two, hide, then unhide one, hard-delete the other', async ({ page }) => {
    // hiddenKeys is the source of truth for the fake backend. Each
    // /visibility PUT mutates it, /api/v1/matches re-reads it.
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
      // .../matches/{matchKey}/visibility
      const matchKey = decodeURIComponent(segs[segs.length - 2] ?? '')
      const body = JSON.parse(route.request().postData() ?? '{}') as { hidden?: boolean }
      visibilityCalls.push({ key: matchKey, hidden: !!body.hidden })
      if (body.hidden) hiddenKeys.add(matchKey)
      else hiddenKeys.delete(matchKey)
      await route.fulfill({ status: 204, body: '' })
    })
    await page.route('**/api/v1/matches/*', async (route: Route, request) => {
      // Single-match hard delete. The visibility route is more
      // specific (matches/*/visibility) so Playwright matches it
      // first; this route catches the bare delete only.
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

    // ── Enter bulk-select mode ────────────────────────────────
    await page.locator('.bulk-select-toggle').click()
    await expect(page.locator('.leaf-row .leaf-checkbox')).toHaveCount(3)

    // Tick the first two.
    await page.locator('.leaf-row').nth(0).locator('.leaf-checkbox').click()
    await page.locator('.leaf-row').nth(1).locator('.leaf-checkbox').click()
    await expect(page.locator('.bulk-action-bar')).toContainText('2 selected')

    // Hide selected.
    await page.locator('.bulk-action-bar .bulk-hide').click()

    // Wait for both visibility PUTs.
    await expect.poll(() => visibilityCalls.length).toBeGreaterThanOrEqual(2)
    expect(visibilityCalls.every((c) => c.hidden === true)).toBe(true)

    // Leaves list now shows only the third row.
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // Hidden drawer header surfaces count "2".
    const drawerToggle = page.locator('.archive-toggle')
    await expect(drawerToggle).toContainText('2')

    // Expand drawer → both archived rows visible.
    await drawerToggle.click()
    await expect(page.locator('.archive-row')).toHaveCount(2)

    // ── Unhide one ────────────────────────────────────────────
    const firstArchive = page.locator('.archive-row').first()
    await firstArchive.locator('.archive-unhide').click()

    await expect.poll(() => visibilityCalls.length).toBeGreaterThanOrEqual(3)
    expect(visibilityCalls[visibilityCalls.length - 1]?.hidden).toBe(false)

    // After unhide, leaves grew to 2, archive shrunk to 1.
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.locator('.archive-row')).toHaveCount(1)

    // ── Hard-delete the remaining archive row ─────────────────
    const lastArchive = page.locator('.archive-row').first()
    await lastArchive.locator('.archive-delete').click()
    // Two-step affordance — Confirm + Cancel reveal in place.
    await expect(lastArchive.locator('.archive-confirm')).toBeVisible()
    await expect(lastArchive.locator('.archive-cancel')).toBeVisible()
    await lastArchive.locator('.archive-confirm').click()

    await expect.poll(() => deleteCalls.length).toBeGreaterThanOrEqual(1)
    expect(deleteCalls.length).toBe(1)

    // Archive empty; drawer collapses to its empty state (or hides).
    await expect(page.locator('.archive-row')).toHaveCount(0)
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })
})

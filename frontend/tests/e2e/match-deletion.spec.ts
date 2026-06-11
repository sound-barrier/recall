/**
 * Match-deletion (soft-delete) E2E.
 *
 * Drives the full client-side flow:
 *   1. Click a `.leaf-row` → MatchDetailPanel opens.
 *   2. Click "Hide match" inside the panel's danger row → confirm step.
 *   3. Confirm → `PUT /api/v1/matches/{matchKey}/visibility` fires with
 *      `{ hidden: true }` (no `match_key` in the body — it lives in
 *      the URL).
 *   4. The detail panel closes; the row vanishes from the leaves list;
 *      the hidden record shows up in the Archive drawer.
 *   5. Cancel aborts without firing any destructive PUT.
 *
 * This spec is the regression test for the original `r.json()`-on-204
 * bug that motivated the CLAUDE.md "UI features need a failing
 * Playwright e2e first" rule — the void-returning writer silently
 * threw and load() never fired. Keep it green forever.
 *
 * Mocks `/api/v1/matches` with a closure-captured `hidden` flag so
 * subsequent GETs see the post-PUT state.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const NORMAL_KEY = 'match-2026-05-10T22-00-00'
const NORMAL_KEY_ENCODED = encodeURIComponent(NORMAL_KEY)
const VISIBILITY_PATH_GLOB = `**/api/v1/matches/${NORMAL_KEY_ENCODED}/visibility`

const singleRecord = (hidden: boolean) => ({
  match_key: NORMAL_KEY,
  source_files: [`${NORMAL_KEY}.png`],
  data: {
    map: 'rialto',
    playlist: 'competitive',
    type: 'control',
    role: 'support',
    hero: 'lucio',
    result: 'victory',
    date: '2026-05-10',
    finished_at: '22:00',
    eliminations: 17,
    assists: 16,
    deaths: 11,
    damage: 7200,
    heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
  },
  parsed_at: '2026-05-10T22:30:00Z',
  ...(hidden ? { hidden: true } : {}),
})

test.describe('match deletion — soft delete + unhide', () => {
  test('Hide → Confirm soft-deletes (PUT hidden=true, row vanishes, Archive shows it)', async ({ page }) => {
    let hidden = false
    let putBody: Record<string, unknown> | null = null
    let getCount = 0

    await page.route('**/api/v1/matches', async (route: Route) => {
      getCount++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(hidden)]),
      })
    })
    await page.route(VISIBILITY_PATH_GLOB, async (route: Route) => {
      putBody = JSON.parse(route.request().postData() ?? '{}')
      hidden = !!putBody.hidden
      // 204 No Content — the canonical writer shape. This is exactly
      // the response that exposed the r.json()-on-204 bug.
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // Click the row → detail panel opens with the MatchCardDanger
    // block rendered inside.
    await page.locator('.leaf-row').first().click()
    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()

    // Two-step affordance — Confirm + Cancel surface inline.
    await expect(page.locator('.danger-btn.danger-confirm')).toBeVisible()
    await expect(page.locator('.danger-btn.danger-cancel')).toBeVisible()

    await page.locator('.danger-btn.danger-confirm').click()

    // Wait for the post-confirm re-fetch to complete by polling on
    // getCount — the click does PUT → load() and load() fires
    // /api/v1/matches once.
    await expect.poll(() => getCount).toBeGreaterThanOrEqual(2)
    // Row disappears (default view drops hidden matches).
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    // PUT body carries just the visibility flag — match_key lives in
    // the URL now, not the payload.
    expect(putBody).toEqual({ hidden: true })

    // Archive drawer shows the hidden record. The toggle surfaces
    // because hiddenRecords.length > 0.
    const archiveToggle = page.locator('.archive-toggle')
    await expect(archiveToggle).toBeVisible()
    await archiveToggle.click()
    await expect(page.locator('.archive-row')).toHaveCount(1)
  })

  test('Cancel aborts the hide without firing the PUT', async ({ page }) => {
    let putCount = 0
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(false)]),
      })
    })
    await page.route(VISIBILITY_PATH_GLOB, async (route: Route) => {
      putCount++
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()
    await page.locator('.danger-btn.danger-cancel').click()

    // Hide button is back, Confirm is gone.
    await expect(page.locator('.danger-btn', { hasText: 'Hide match' })).toBeVisible()
    await expect(page.locator('.danger-btn.danger-confirm')).toHaveCount(0)
    // Match still present in the leaves list.
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    // Critical: no destructive PUT happened.
    expect(putCount).toBe(0)
  })

  test('Archive Unhide PUTs hidden=false and restores the row to the leaves list', async ({ page }) => {
    let hidden = true
    let putBody: Record<string, unknown> | null = null

    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(hidden)]),
      })
    })
    await page.route(VISIBILITY_PATH_GLOB, async (route: Route) => {
      putBody = JSON.parse(route.request().postData() ?? '{}')
      hidden = !!putBody.hidden
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Hidden row isn't in the leaves list but surfaces in the
    // archive drawer.
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    await page.locator('.archive-toggle').click()
    await expect(page.locator('.archive-row')).toHaveCount(1)

    // Click Unhide — single-click, no confirm step (restorative).
    await page.locator('.archive-row .archive-unhide').click()
    await expect.poll(() => putBody).not.toBeNull()
    expect(putBody).toEqual({ hidden: false })

    // After the post-PUT reload, the row is back in the leaves list
    // and the archive drawer empties.
    await expect(page.locator('.leaf-row')).toHaveCount(1)
  })
})

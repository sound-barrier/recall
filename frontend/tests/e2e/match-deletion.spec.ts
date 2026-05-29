/**
 * Match-deletion (soft-delete) E2E.
 *
 * The hermetic e2e server boots against an empty SQLite DB, so we
 * intercept the JSON endpoints with `page.route()` and serve canned
 * fixtures — that exercises the full client-side flow (filter rail
 * toggle, MatchCard danger row, confirm step, outbound PUT to
 * `/api/v1/matches/{matchKey}/visibility`).
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const NORMAL_KEY = 'match:2026-05-10T22:00:00'
// Path-encoded form of NORMAL_KEY — the colon must be percent-encoded
// because it carries meaning in URLs. encodeURIComponent on the
// frontend produces this exact form.
const NORMAL_KEY_ENCODED = encodeURIComponent(NORMAL_KEY)
const VISIBILITY_PATH_GLOB = `**/api/v1/matches/${NORMAL_KEY_ENCODED}/visibility`

// A single match. Tests flip `hidden` between requests to drive the
// flow: hide-confirm → next /api/v1/matches sees hidden=true →
// card disappears; show-hidden toggle reveals it dimmed; unhide →
// next response drops the flag.
const singleRecord = (hidden: boolean) => ({
  match_key: NORMAL_KEY,
  source_files: [`${NORMAL_KEY}.png`],
  data: {
    map: 'rialto',
    mode: 'competitive',
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
  test('Hide → Confirm soft-deletes (POSTs hidden=true, card vanishes)', async ({ page }) => {
    let hidden = false
    let postBody: Record<string, unknown> | null = null
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
      postBody = JSON.parse(route.request().postData() ?? '{}')
      hidden = !!postBody.hidden
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    await page.locator('.leaf-row').first().click()
    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()

    // Two-step affordance.
    await expect(page.locator('.danger-btn', { hasText: 'Confirm' })).toBeVisible()
    await expect(page.locator('.danger-btn', { hasText: 'Cancel' })).toBeVisible()

    await page.locator('.danger-btn', { hasText: 'Confirm' }).click()

    // Wait for the post-confirm re-fetch to complete by polling on
    // getCount — the click does PUT → load() and load() fires
    // /api/v1/matches once. Without this, toHaveCount(0) races
    // with the in-flight refetch.
    await expect.poll(() => getCount).toBeGreaterThanOrEqual(2)
    // Card disappears (default view drops hidden matches).
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    // PUT body carries just the visibility flag — match_key lives in
    // the URL now, not the payload.
    expect(postBody).toEqual({ hidden: true })
  })

  test('Cancel aborts the hide without POSTing', async ({ page }) => {
    let postCount = 0
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(false)]),
      })
    })
    await page.route(VISIBILITY_PATH_GLOB, async (route: Route) => {
      postCount++
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click()

    await page.locator('.danger-btn', { hasText: 'Hide match' }).click()
    await page.locator('.danger-btn', { hasText: 'Cancel' }).click()

    // Hide button is back, Confirm is gone.
    await expect(page.locator('.danger-btn', { hasText: 'Hide match' })).toBeVisible()
    await expect(page.locator('.danger-btn', { hasText: 'Confirm' })).toHaveCount(0)
    // Match still present.
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    // Critical: no destructive PUT happened.
    expect(postCount).toBe(0)
  })

  test('Show-hidden toggle reveals a hidden match with the dimmed class', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(true)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Default: hidden match is invisible. But the Hidden · 1 toggle
    // still surfaces because hiddenMatchCount counts all records.
    await expect(page.locator('.leaf-row')).toHaveCount(0)
    const toggle = page.locator('.undated-toggle').filter({ hasText: 'Hidden' })
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.match.hidden')).toHaveCount(1)
  })

  test('Unhide on a hidden card PUTs hidden=false (no confirm step)', async ({ page }) => {
    let postBody: Record<string, unknown> | null = null
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([singleRecord(true)]),
      })
    })
    await page.route(VISIBILITY_PATH_GLOB, async (route: Route) => {
      postBody = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()

    // Reveal the hidden card via the toggle.
    await page.locator('.undated-toggle').filter({ hasText: 'Hidden' }).click()
    await page.locator('.match.hidden').first()

    // Unhide is one-click — strictly restorative, no confirm step.
    await page.locator('.danger-btn', { hasText: 'Unhide' }).click()
    expect(postBody).toEqual({ hidden: false })
  })
})

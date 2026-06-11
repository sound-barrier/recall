/**
 * Right-click context menu — extended actions (item 7).
 *
 * The pre-existing menu shipped with Open detail / Filter from this
 * match / Hide. This spec covers the five additions:
 *
 *   - Tag — opens detail panel + focuses tag input
 *   - Edit annotation — opens detail panel + focuses note input
 *   - Copy replay code — writes the record's replay_code to clipboard
 *   - Copy match link — writes the match_key to clipboard
 *   - Open source folder — Wails-only; gated v-if so absent in
 *     server mode (this spec runs against the server build, so we
 *     assert the menu item is NOT rendered)
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

const KEY = 'match-2026-05-10T22-00-00'
const REPLAY = 'X1Y2Z3'

function record(matchKey: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
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
    annotation: { replay_code: REPLAY },
  }
}

test.describe('match row context menu — extended actions', () => {
  test('Tag opens detail panel with the tag input focused', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.locator('[data-row-ctx-tag]').click()

    await expect(page.locator('aside.detail-panel')).toBeVisible()
    // The tag input picks up focus on mount.
    await expect(page.locator(`#tags-${KEY}`)).toBeFocused()
  })

  test('Edit annotation opens detail panel with the note textarea focused', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.locator('[data-row-ctx-edit-annotation]').click()

    await expect(page.locator('aside.detail-panel')).toBeVisible()
    await expect(page.locator(`#note-${KEY}`)).toBeFocused()
  })

  test('Copy match link writes the match_key to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.locator('[data-row-ctx-copy-link]').click()

    const clipboard = await page.evaluate(async () => await navigator.clipboard.readText())
    expect(clipboard).toBe(KEY)
  })

  test('Copy replay code writes the replay_code to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'])
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })
    await page.locator('[data-row-ctx-copy-replay]').click()

    const clipboard = await page.evaluate(async () => await navigator.clipboard.readText())
    expect(clipboard).toBe(REPLAY)
  })

  test('Open source folder item is absent in server-mode builds (IS_WAILS=false)', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([record(KEY)]),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('.leaf-row').first().click({ button: 'right' })

    await expect(page.locator('[data-row-ctx-open-folder]')).toHaveCount(0)
  })
})

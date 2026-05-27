/**
 * Match-notes-search E2E.
 *
 * The FilterRail gains a free-text search input that substring-matches
 * against `annotation.note` content (case-insensitive). This spec
 * covers the happy path:
 *
 *   1. three matches load — one with note "ally rage-quit", one with
 *      "huge clutch", one with no annotation
 *   2. type "clutch" into the search input
 *   3. only the "huge clutch" match remains
 *   4. clear the input via the × button
 *   5. all three matches return
 *
 * Same `page.route()` mocking pattern as match-tags.spec.ts — no
 * mutation of state, just substring-matching against a canned list.
 */
import { test, expect, type Route } from '@playwright/test'

function record(matchKey: string, note?: string) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
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
    ...(note ? { annotation: { leaver: '', note } } : {}),
  }
}

test.describe('match notes search', () => {
  test('substring filter narrows then clears', async ({ page }) => {
    const records = [
      record('match:1', 'ally rage-quit, threw the game'),
      record('match:2', 'huge clutch on the second point'),
      record('match:3'),
    ]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(records),
      })
    })

    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.match')).toHaveCount(3)

    // Type into the dedicated note-search input on the FilterRail.
    // The input carries aria-label="Search match notes" so the
    // selector is stable against text/icon-only changes.
    const search = page.locator('input[aria-label="Search match notes"]')
    await search.fill('clutch')
    await expect(page.locator('.match')).toHaveCount(1)

    // The clear control sits inline inside the input shell.
    await page.locator('button[aria-label="Clear note search"]').click()
    await expect(search).toHaveValue('')
    await expect(page.locator('.match')).toHaveCount(3)
  })

  test('search is case-insensitive', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          record('match:1', 'Ally rage-quit'),
          record('match:2', 'huge clutch'),
        ]),
      })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await page.locator('input[aria-label="Search match notes"]').fill('ALLY')
    await expect(page.locator('.match')).toHaveCount(1)
  })
})

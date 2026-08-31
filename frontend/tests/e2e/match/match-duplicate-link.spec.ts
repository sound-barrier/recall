/**
 * The "keep separate" verdict, remembered.
 *
 * Deciding two matches are different is real work — reading two scoreboards
 * and judging. Until now that judgment was recorded only as the absence of
 * an ambiguity: nothing on either card said the call had been made, so the
 * next time the user met one of them they had to make it again.
 *
 * Now both cards carry it, and each names the other. The link is symmetric
 * because "these two look like the same match" is a claim about the pair,
 * and clicking it takes you to the twin — which is the whole point, since
 * the only way to check a duplicate judgment is to look at both.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const KEPT = 'match-2026-05-10T21-14-03'
const ORIGINAL = 'match-2026-05-10T18-05-22'

const match = (key: string, at: string, duplicateOf?: string) => ({
  match_key: key,
  source_files: [`${key}.png`],
  source_types: { [`${key}.png`]: 'summary' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'escort', role: 'support',
    hero: 'ana', result: 'victory', date: '2026-05-10', finished_at: at,
  },
  ...(duplicateOf ? { duplicate_of: [duplicateOf] } : {}),
  parsed_at: `2026-05-10T${at}:00Z`,
})

const CORPUS = [
  match(KEPT, '21:14', ORIGINAL),
  match(ORIGINAL, '18:05', KEPT),
]

test.describe('duplicate link — the judgment both cards carry', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.leaf-row').first()).toBeVisible()
  })

  test('both rows say they were judged separate, and each names the other', async ({ page }) => {
    const chips = page.getByRole('button', { name: /^Possible duplicate of/ })
    await expect(chips).toHaveCount(2)
  })

  test('the chip opens the match it names', async ({ page }) => {
    // Newest first, so the first row is the later capture; its chip points
    // back at the original.
    await page.locator('.leaf-row').first()
      .getByRole('button', { name: /^Possible duplicate of/ }).click()

    // The panel renders the naive scoreboard clock in 12-hour form. Both
    // assertions matter: the first proves the twin opened, the second that
    // the chip did not simply reopen the card it sits on.
    const panel = page.locator('.detail-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('6:05pm')
    await expect(panel).not.toContainText('9:14pm')
  })
})

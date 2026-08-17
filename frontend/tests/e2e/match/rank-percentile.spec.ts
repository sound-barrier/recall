/**
 * Rank-percentile E2E — the season-4 "HIGHER RANKED THAN N% OF PLAYERS"
 * reading, from the wire to the Rank Update block.
 *
 * This exists as an e2e rather than a component test because the value only
 * means anything if it survives the whole chain: OpenAPI schema -> generated
 * client -> query cache -> store -> render. A component test would pass with
 * the field missing from the spec entirely.
 *
 * The absent case is the one worth guarding hardest. A placement screen
 * genuinely has no percentile, so the block must show NOTHING rather than
 * "0%" — a believable number that would be a lie about where the player sits.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

function rankRecord(matchKey: string, percentile?: number) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'rank' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'victory',
      date: '2026-08-16', finished_at: '22:00',
      rank: 'platinum', level: 2, rank_progress: 67,
      ...(percentile === undefined ? {} : { rank_percentile: percentile }),
    },
    parsed_at: '2026-08-16T22:30:00Z',
  }
}

async function openFirstMatch(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
}

test.describe('rank percentile', () => {
  test('renders the population share when the screenshot reported one', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([rankRecord('m1', 57)]),
      })
    })
    await openFirstMatch(page)

    const block = page.locator('.rank-block')
    await expect(block).toBeVisible()
    // The wording says what the number MEANS. "57%" alone next to
    // "67% progress" is two bare percentages the user has to disambiguate.
    await expect(block).toContainText('57%')
    await expect(block).toContainText(/higher ranked than/i)
    // And it must not have swallowed the progress reading on the same line.
    await expect(block).toContainText('67% progress')
  })

  test('shows nothing at all when the screenshot reported none', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([rankRecord('m1')]),
      })
    })
    await openFirstMatch(page)

    const block = page.locator('.rank-block')
    await expect(block).toBeVisible()
    await expect(block).toContainText('platinum 2')
    await expect(block).not.toContainText(/higher ranked than/i)
    // The specific failure this guards: a non-optional render would print
    // "0%", which reads as a real measurement of being above nobody.
    await expect(block).not.toContainText('0%')
  })

  // 0 is a legitimate reading, and the one a truthiness check silently drops —
  // the same bug the sibling rank_progress / change_percent lines still carry.
  test('renders a genuine zero rather than treating it as absent', async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify([rankRecord('m1', 0)]),
      })
    })
    await openFirstMatch(page)

    await expect(page.locator('.rank-block')).toContainText(/higher ranked than\s*0%/i)
  })
})

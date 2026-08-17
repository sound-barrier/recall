/**
 * Rank-movement sign + zero rendering in the Rank Update block.
 *
 * `change_percent` became SIGNED when the parser learned to read a demotion's
 * negative movement — seven golden captures now carry -25 / -26 / -27 / -32.
 * The template still prepended a literal '+', so a demotion rendered "+-32%":
 * two contradictory signs on the number whose whole job is direction.
 *
 * The zero cases are the other half. Both `change_percent` and `rank_progress`
 * were gated on truthiness, so a genuine 0 — "this match moved the rank by
 * nothing", "this rank sits at the bottom of its division" — was hidden as if
 * the screenshot had never reported it. That is the same bug the sibling
 * `rank_percentile` line was deliberately written to avoid, and its comment
 * says so; these tests hold the other two to the same rule.
 *
 * e2e rather than a component test because the value has to survive the whole
 * chain — OpenAPI schema, generated client, query cache, store, render — and a
 * component test would pass with the field absent from the wire entirely.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

type RankFields = {
  change_percent?: number
  rank_progress?: number
}

function rankRecord(fields: RankFields) {
  return {
    match_key: 'm1',
    source_files: ['m1.png'],
    source_types: { 'm1.png': 'rank' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'defeat',
      date: '2026-08-16', finished_at: '22:00',
      rank: 'platinum', level: 2,
      ...fields,
    },
    parsed_at: '2026-08-16T22:30:00Z',
  }
}

async function openRankBlock(page: import('@playwright/test').Page, fields: RankFields) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([rankRecord(fields)]),
    })
  })
  await page.goto('/')
  await page.getByRole('tab', { name: /^Matches/ }).click()
  await expect(page.locator('.leaf-row')).toHaveCount(1)
  await page.locator('.leaf-row').first().click()
  await expect(page.locator('aside.detail-panel')).toBeVisible()
  const block = page.locator('.rank-block')
  await expect(block).toBeVisible()
  return block
}

test.describe('rank movement sign', () => {
  test('renders a demotion with one minus sign, never "+-"', async ({ page }) => {
    const block = await openRankBlock(page, { change_percent: -32, rank_progress: 67 })

    await expect(block).toContainText('-32%')
    // The specific regression: a hardcoded '+' in front of a negative value.
    await expect(block).not.toContainText('+-')
    // And it must not have lost the sign altogether by stripping it.
    await expect(block).not.toContainText('+32%')
  })

  test('keeps the plus on a promotion', async ({ page }) => {
    const block = await openRankBlock(page, { change_percent: 40, rank_progress: 67 })

    await expect(block).toContainText('+40%')
  })

  // 0 is a real reading: the match resolved and moved the rank by nothing.
  // Hiding it claims the screenshot never reported movement at all.
  test('renders a genuine zero movement rather than hiding it', async ({ page }) => {
    const block = await openRankBlock(page, { change_percent: 0, rank_progress: 67 })

    await expect(block).toContainText('0%')
  })

  // Same rule for progress: 0% is the bottom of a division, not "unknown".
  test('renders zero progress rather than hiding it', async ({ page }) => {
    const block = await openRankBlock(page, { change_percent: 40, rank_progress: 0 })

    await expect(block).toContainText('0% progress')
  })
})

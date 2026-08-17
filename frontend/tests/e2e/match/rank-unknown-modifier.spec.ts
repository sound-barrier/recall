/**
 * Unrecognized modifier text in the Rank Update block.
 *
 * The parser matches modifier chips against a closed vocabulary
 * (pkg/parser/modifiers.yaml). Anything outside it used to be written to a log
 * line and dropped — which is exactly how season 4's VARIANCE chip rode every
 * post-placement rank screen for a whole season without anyone noticing. The
 * text now survives to the row, so the next season announces itself in the app
 * rather than in a log nobody greps.
 *
 * Deliberately rendered as a SENTENCE, not as a chip beside the real
 * modifiers: a chip would assert this text IS a modifier, when the only thing
 * known about it is that the vocabulary could not account for it. The measured
 * false-positive rate makes that distinction load-bearing — the same detection
 * fires on 3 of 37 rank captures that have no new chip at all (an
 * ENDORSEMENT RECEIVED toast overlapping the band, plus two OCR garbles).
 *
 * e2e because only this proves the whole chain: OpenAPI schema → generated
 * client → query cache → store → render.
 */
import { test, expect } from '../_fixtures'
import type { Route } from '@playwright/test'

function rankRecord(matchKey: string, over: Record<string, unknown> = {}) {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'rank' },
    data: {
      map: 'rialto', playlist: 'competitive', game_mode: 'control',
      role: 'support', hero: 'lucio', result: 'defeat',
      date: '2026-08-16', finished_at: '22:00',
      rank: 'platinum', level: 2, rank_progress: 67,
      modifiers: ['reversal', 'defeat'],
      ...over,
    },
    parsed_at: '2026-08-16T22:30:00Z',
  }
}

async function openRankBlock(
  page: import('@playwright/test').Page,
  over: Record<string, unknown> = {},
) {
  await page.route('**/api/v1/matches', async (route: Route) => {
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify([rankRecord('m1', over)]),
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

test.describe('unrecognized rank modifier', () => {
  test('shows the text the vocabulary could not account for', async ({ page }) => {
    const block = await openRankBlock(page, { modifiers_raw: 'MOMENTUM' })

    await expect(block).toContainText('MOMENTUM')
    // The wording has to say the app does not KNOW it — not that it is a
    // modifier the player earned.
    await expect(block).toContainText(/does not recognize|doesn't recognize/i)
    // And it must not have displaced the modifiers that DID resolve.
    await expect(block).toContainText('reversal')
  })

  test('says nothing when every chip resolved', async ({ page }) => {
    const block = await openRankBlock(page)

    await expect(block).toContainText('reversal')
    await expect(block).not.toContainText(/does not recognize|doesn't recognize/i)
  })

  // The placement-screen shape — a rank screen with no settled tier, which is
  // where this text is most likely to be the ONLY thing readable — is covered
  // by match/rank-partial.spec.ts, because rendering the block at all when the
  // tier is empty is that item's contract, not this one's.
})

/**
 * Teammate (member) narrow-filter E2E.
 *
 * The Narrow panel exposes a "Teammates" chip-cloud, mirroring the Tags
 * picker, that filters the set by the player names annotated onto each
 * match (`annotation.members`). Unlike tags (OR), picking MULTIPLE
 * teammates is AND — the match must include EVERY picked teammate, so
 * you can isolate a specific stack ("how does the Alice+Bob duo do?").
 *
 * Each pick surfaces a removable "With" active-clause chip in the
 * dossier header.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(matchKey: string, members: string[], result = 'victory') {
  return {
    match_key: matchKey,
    source_files: [`${matchKey}.png`],
    data: {
      map: 'rialto',
      playlist: 'competitive',
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result,
      date: '2026-05-10',
      finished_at: '22:00',
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '11:25' }],
    },
    parsed_at: `2026-05-10T22:30:00Z`,
    annotation: { tags: [], leaver: '', note: '', members, replay_code: '' },
  }
}

// Alice plays in 1+2, Bob in 1+3, match:4 is solo (no teammates). So the
// Alice+Bob INTERSECTION is just match:1.
const CORPUS = [
  record('match:1', ['Alice', 'Bob']),
  record('match:2', ['Alice'], 'defeat'),
  record('match:3', ['Bob']),
  record('match:4', []),
]

async function openNarrow(page: Page) {
  await page.locator('[data-narrow-trigger]').click()
  await expect(page.locator('#narrow-popover')).toBeVisible()
}

function teammateChip(page: Page, name: string) {
  return page.locator(`.np-chip[data-member="${name}"]`)
}

test.describe('teammate (member) narrow filter', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.goto('/')
    await page.locator('#tab-matches').click()
    await expect(page.locator('.leaf-row')).toHaveCount(4)
  })

  test('the Teammates section lists every annotated player', async ({ page }) => {
    await openNarrow(page)
    await expect(teammateChip(page, 'Alice')).toBeVisible()
    await expect(teammateChip(page, 'Bob')).toBeVisible()
  })

  test('picking one teammate narrows to their games', async ({ page }) => {
    await openNarrow(page)
    await teammateChip(page, 'Alice').click()
    await page.locator('.np-close').click()
    // Alice appears in match:1 + match:2.
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })

  test('picking two teammates is AND — only the games they BOTH played', async ({ page }) => {
    await openNarrow(page)
    await teammateChip(page, 'Alice').click()
    await teammateChip(page, 'Bob').click()
    await page.locator('.np-close').click()
    // Only match:1 has both Alice AND Bob.
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row[data-match-key="match:1"]')).toBeVisible()
  })

  test('each pick surfaces a removable "With" chip; × restores the wider set', async ({ page }) => {
    await openNarrow(page)
    await teammateChip(page, 'Alice').click()
    await teammateChip(page, 'Bob').click()
    await page.locator('.np-close').click()

    const chips = page.locator('.active-chip.member')
    await expect(chips).toHaveCount(2)
    await expect(page.locator('.leaf-row')).toHaveCount(1)

    // Drop Bob → back to the Alice-only set.
    await page.locator('.active-chip.member [aria-label="Drop teammate Bob"]').click()
    await expect(page.locator('.active-chip.member')).toHaveCount(1)
    await expect(page.locator('.leaf-row')).toHaveCount(2)
  })
})

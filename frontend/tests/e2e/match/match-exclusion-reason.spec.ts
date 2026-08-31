/**
 * Match exclusion reasons — "this one shouldn't count, and here's why".
 *
 * A placement match, an MMR adjustment or a game lost to your own router
 * says nothing about how you played, but deleting it loses a real game and
 * hiding it loses the record. Marking WHY it doesn't count drops it from the
 * win-rate while it stays in the list, exactly like the leaver control's
 * "Drop from tally" — which is the control this one sits beside.
 *
 * Marking a match IS the instruction, so the default handling is
 * drop-from-tally; the narrow panel can override in both directions.
 */
import type { Route } from '@playwright/test'

import { test, expect } from '../_fixtures'

const match = (i: number, result: string, exclusionReason?: string) => ({
  match_key: `m${i}`,
  source_files: [`m${i}.png`],
  source_types: { [`m${i}.png`]: 'summary' },
  data: {
    map: 'rialto', playlist: 'competitive', game_mode: 'control', role: 'support', hero: 'ana',
    result, date: `2026-05-0${i + 1}`, finished_at: '20:00',
  },
  ...(exclusionReason
    ? { annotation: { leavers: [], throwers: [], members: [], tags: [], exclusion_reason: exclusionReason } }
    : {}),
  parsed_at: `2026-05-0${i + 1}T20:00:00Z`,
})

// Two wins and a loss: 67% counting everything, 100% once the loss is
// excluded as a placement.
const CORPUS = [
  match(0, 'victory'),
  match(1, 'victory'),
  match(2, 'defeat', 'placement'),
]

test.describe('match exclusion reasons', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CORPUS) })
    })
    await page.setViewportSize({ width: 1500, height: 1000 })
    await page.goto('/')
    await page.getByRole('tab', { name: /^Matches/ }).click()
    await expect(page.locator('.set-dossier')).toBeVisible()
  })

  test('an excluded match leaves the win-rate but stays in the list', async ({ page }) => {
    await expect(page.locator('[data-widget-id="winrate"]').locator('.kpi-value')).toHaveText('100%')
    // Still on the list — excluding is not hiding.
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(3)
  })

  test('the narrow panel can count them anyway, or hide them outright', async ({ page }) => {
    const section = page.locator('.np-section', { hasText: 'Excluded matches' })

    await section.locator('.np-chip', { hasText: 'Count them' }).first().click()
    await expect(page.locator('[data-widget-id="winrate"]').locator('.kpi-value')).toHaveText('67%')
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(3)

    await section.locator('.np-chip', { hasText: 'Hide entirely' }).first().click()
    await expect.poll(() => page.locator('.leaf-row').count()).toBe(2)
  })

  test('the journal records the reason on the match', async ({ page }) => {
    let put: Record<string, unknown> | null = null
    await page.route('**/api/v1/matches/m0/annotation', async (route: Route) => {
      put = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>
      await route.fulfill({ status: 204, body: '' })
    })

    // Oldest-last ordering: m0 is the one match with no reason on it yet.
    // Routing only m0's annotation makes a click on the wrong row fail loudly.
    await page.locator('.leaf-row').last().click()
    await page.getByRole('button', { name: 'Mark this match as a placement', exact: true }).click()

    await expect.poll(() => put?.exclusion_reason).toBe('placement')
  })
})

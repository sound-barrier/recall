/**
 * Leaf-row click-to-filter (cozy / compact).
 *
 * The Map, Mode and Queue cells are filter buttons — clicking one toggles that
 * narrow dimension (the same Excel-autofilter pattern as the data table), so the
 * set shrinks without opening the detail panel.
 */
import type { Page, Route } from '@playwright/test'

import { test, expect } from './_fixtures'

function record(key: string, map: string, playlist: string, queueType: string) {
  return {
    match_key: key,
    source_files: [`${key}.png`],
    queue_type: queueType,
    data: {
      map,
      playlist,
      game_mode: 'control',
      role: 'support',
      hero: 'lucio',
      result: 'victory',
      date: '2026-05-10',
      finished_at: '22:00',
      eliminations: 15,
      assists: 10,
      deaths: 8,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '10:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

async function setup(page: Page, corpus: unknown[]) {
  await page.route('**/api/v1/matches', (route: Route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(corpus) }),
  )
  await page.goto('/')
  await page.locator('#tab-matches').click()
  await expect(page.locator('.leaf-row')).toHaveCount(corpus.length)
}

test.describe('leaf-row click-to-filter (cozy/compact)', () => {
  test('clicking Map then Mode narrows the set without opening the panel', async ({ page }) => {
    await setup(page, [
      record('m1', 'rialto', 'competitive', 'role'),
      record('m2', 'busan', 'quickplay', 'open'),
      record('m3', 'rialto', 'quickplay', 'open'),
    ])

    // Map → rialto (m1 + m3 remain; busan gone).
    await page.locator('.leaf-row[data-match-key="m1"] .leaf-map').click()
    await expect(page.locator('.leaf-row')).toHaveCount(2)
    await expect(page.locator('.leaf-row[data-match-key="m2"]')).toHaveCount(0)
    await expect(page.locator('aside.detail-panel')).toHaveCount(0)

    // Mode → competitive stacks (rialto AND competitive) → m1 alone.
    await page.locator('.leaf-row[data-match-key="m1"] .leaf-mode-chip').click()
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row[data-match-key="m1"]')).toHaveCount(1)
  })

  test('clicking the Queue chip narrows by queue type', async ({ page }) => {
    await setup(page, [
      record('m1', 'rialto', 'competitive', 'role'),
      record('m2', 'busan', 'quickplay', 'open'),
    ])
    await page.locator('.leaf-row[data-match-key="m2"] .leaf-queue-chip').click() // open queue
    await expect(page.locator('.leaf-row')).toHaveCount(1)
    await expect(page.locator('.leaf-row[data-match-key="m2"]')).toHaveCount(1)
  })
})

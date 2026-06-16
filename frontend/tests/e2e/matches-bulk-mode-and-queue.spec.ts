/**
 * Bulk-set sticky toolbar — per-row checkboxes drive Select-all /
 * Deselect-all + two menu buttons (Set play mode / Set queue) that
 * write to the new collection-level endpoints in ONE PUT.
 *
 * Contract pinned here:
 *
 *   - Ticking ≥1 row reveals the sticky toolbar with the count chip.
 *   - "Select all (N)" picks every visible row.
 *   - Set play mode → Competitive fires ONE
 *     PUT /api/v1/matches/play-mode with body
 *     {match_keys: [...], play_mode: 'competitive'} — not N
 *     per-match PUTs.
 *   - Set queue → Open Queue fires ONE
 *     PUT /api/v1/matches/queue with body
 *     {match_keys: [...], queue_type: 'open'}.
 *   - Clear (Unknown mode) submits play_mode: '' — the bulk Clear
 *     semantic.
 *   - "Clear" (Deselect) hides the toolbar; selection drops to 0.
 */
import type { Route } from '@playwright/test'

import { test, expect } from './_fixtures'

type Match = {
  match_key: string
  source_files: string[]
  source_types: Record<string, string>
  play_mode?: 'quickplay' | 'competitive'
  queue_type?: 'role' | 'open'
  data: Record<string, unknown>
  parsed_at: string
}

function rec(matchKey: string): Match {
  return {
    match_key:    matchKey,
    source_files: [`${matchKey}.png`],
    source_types: { [`${matchKey}.png`]: 'summary' },
    data: {
      map:           'rialto',
      game_mode:          'control',
      hero:          'lucio',
      result:        'victory',
      date:          '2026-05-10',
      finished_at:   '22:00',
      eliminations:  10,
      assists:       5,
      deaths:        3,
      heroes_played: [{ hero: 'lucio', percent_played: 100, play_time: '5:00' }],
    },
    parsed_at: '2026-05-10T22:30:00Z',
  }
}

test.describe('Matches — bulk play-mode and queue-type setters', () => {
  test('Select all → Set play mode → Competitive fires ONE bulk PUT with every key', async ({ page }) => {
    const matches = [rec('a'), rec('b'), rec('c')]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    let bulkPlayModeReq: { body: unknown } | null = null
    await page.route('**/api/v1/matches/play-mode', async (route: Route) => {
      bulkPlayModeReq = { body: await route.request().postDataJSON() }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()
    await expect(page.locator('[data-match-key]')).toHaveCount(3)

    // Tick one row to reveal the toolbar, then "Select all (3)".
    await page.locator('[data-match-key="a"] .leaf-checkbox').click()
    await expect(page.locator('[data-bulk-menu="play-mode"]')).toBeVisible()
    await page.locator('button.bulk-select-all').click()

    // Open the Set play mode menu and pick Competitive.
    await page.locator('[data-bulk-menu="play-mode"]').click()
    await page.locator('[data-bulk-set-play-mode="competitive"]').click()

    await expect.poll(() => bulkPlayModeReq).not.toBeNull()
    const body = bulkPlayModeReq!.body as { match_keys: string[]; play_mode: string }
    expect(body.play_mode).toBe('competitive')
    expect([...body.match_keys].sort()).toEqual(['a', 'b', 'c'])

    // Selection clears optimistically — toolbar gone after the action.
    await expect(page.locator('[data-bulk-menu="play-mode"]')).toBeHidden()
  })

  test('Set queue → Open Queue fires ONE bulk PUT to /queue', async ({ page }) => {
    const matches = [rec('a'), rec('b')]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    let bulkQueueReq: { body: unknown } | null = null
    await page.route('**/api/v1/matches/queue', async (route: Route) => {
      bulkQueueReq = { body: await route.request().postDataJSON() }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    await page.locator('[data-match-key="a"] .leaf-checkbox').click()
    await page.locator('[data-match-key="b"] .leaf-checkbox').click()
    await page.locator('[data-bulk-menu="queue"]').click()
    await page.locator('[data-bulk-set-queue="open"]').click()

    await expect.poll(() => bulkQueueReq).not.toBeNull()
    const body = bulkQueueReq!.body as { match_keys: string[]; queue_type: string }
    expect(body.queue_type).toBe('open')
    expect([...body.match_keys].sort()).toEqual(['a', 'b'])
  })

  test('Clear (Unknown mode) submits the empty-string bulk Clear semantic', async ({ page }) => {
    const matches = [rec('a')]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    let req: { body: unknown } | null = null
    await page.route('**/api/v1/matches/play-mode', async (route: Route) => {
      req = { body: await route.request().postDataJSON() }
      await route.fulfill({ status: 204, body: '' })
    })

    await page.goto('/')
    await expect(page.locator('#panel-matches')).toBeVisible()

    await page.locator('[data-match-key="a"] .leaf-checkbox').click()
    await page.locator('[data-bulk-menu="play-mode"]').click()
    await page.locator('[data-bulk-set-play-mode=""]').click()

    await expect.poll(() => req).not.toBeNull()
    expect((req!.body as { play_mode: string }).play_mode).toBe('')
  })

  test('Clear button (deselect all) hides the toolbar', async ({ page }) => {
    const matches = [rec('a'), rec('b')]
    await page.route('**/api/v1/matches', async (route: Route) => {
      await route.fulfill({
        status: 200, contentType: 'application/json', body: JSON.stringify(matches),
      })
    })

    await page.goto('/')
    await page.locator('[data-match-key="a"] .leaf-checkbox').click()
    await expect(page.locator('[data-bulk-menu="play-mode"]')).toBeVisible()
    await page.locator('button.bulk-cancel').first().click()
    await expect(page.locator('[data-bulk-menu="play-mode"]')).toBeHidden()
  })
})
